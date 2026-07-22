import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useSession } from "@/hooks/use-session";
import type { Database } from "@/integrations/supabase/types";

export type OrgRole = Database["public"]["Enums"]["org_role"];
export type OrgStatus = Database["public"]["Enums"]["org_status"];

export type Membership = {
  role: OrgRole;
  organization: {
    id: string;
    name: string;
    slug: string;
    description: string | null;
    logo_url: string | null;
    status: OrgStatus;
    created_by: string | null;
  };
};

type Ctx = {
  memberships: Membership[];
  currentOrgId: string | null;
  currentMembership: Membership | null;
  setCurrentOrgId: (id: string | null) => void;
  isLoading: boolean;
  refetch: () => void;
};

const LEGACY_STORAGE_KEY = "stackly.currentOrgId";
const storageKeyFor = (userId: string | undefined | null) =>
  userId ? `stackly.currentOrgId.${userId}` : null;
const OrgContext = createContext<Ctx | null>(null);

export function OrganizationProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const userId = user?.id ?? null;
  const [currentOrgId, setCurrentOrgIdState] = useState<string | null>(null);

  // Load per-user selection whenever the signed-in user changes. This avoids
  // leaking a previous user's org id into a fresh session on the same browser.
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Clean up the legacy shared key so it can't leak across accounts.
    try {
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      /* ignore */
    }
    const key = storageKeyFor(userId);
    if (!key) {
      setCurrentOrgIdState(null);
      return;
    }
    setCurrentOrgIdState(window.localStorage.getItem(key));
  }, [userId]);

  const query = useQuery({
    enabled: !!user,
    queryKey: ["memberships", userId],
    queryFn: async (): Promise<Membership[]> => {
      const { data, error } = await supabase
        .from("organization_members")
        .select(
          "role, organization:organization_id(id, name, slug, description, logo_url, status, created_by)",
        )
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? [])
        .map((r) => ({
          role: r.role as OrgRole,
          organization: r.organization as Membership["organization"],
        }))
        .filter((m) => m.organization);
    },
  });

  const memberships = query.data ?? [];

  useEffect(() => {
    if (!userId || query.isLoading) return;
    const key = storageKeyFor(userId);
    if (!key) return;
    const stillValid =
      !!currentOrgId && memberships.some((m) => m.organization.id === currentOrgId);
    if (stillValid) return;
    if (memberships.length > 0) {
      const next = memberships[0].organization.id;
      setCurrentOrgIdState(next);
      try {
        window.localStorage.setItem(key, next);
      } catch {
        /* ignore */
      }
    } else if (currentOrgId !== null) {
      setCurrentOrgIdState(null);
      try {
        window.localStorage.removeItem(key);
      } catch {
        /* ignore */
      }
    }
  }, [memberships, currentOrgId, userId, query.isLoading]);

  const setCurrentOrgId = (id: string | null) => {
    setCurrentOrgIdState(id);
    const key = storageKeyFor(userId);
    if (!key) return;
    try {
      if (id) window.localStorage.setItem(key, id);
      else window.localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  };

  const currentMembership = useMemo(
    () => memberships.find((m) => m.organization.id === currentOrgId) ?? null,
    [memberships, currentOrgId],
  );

  return (
    <OrgContext.Provider
      value={{
        memberships,
        currentOrgId,
        currentMembership,
        setCurrentOrgId,
        isLoading: query.isLoading,
        refetch: query.refetch,
      }}
    >
      {children}
    </OrgContext.Provider>
  );
}


export function useCurrentOrg() {
  const ctx = useContext(OrgContext);
  if (!ctx) throw new Error("useCurrentOrg must be used within OrganizationProvider");
  return ctx;
}
