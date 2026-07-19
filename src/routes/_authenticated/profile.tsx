import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { profileSchema, passwordSchema, type ProfileValues } from "@/lib/auth-schemas";
import { useSession } from "@/hooks/use-session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
});

const additionalSchema = z.object({
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+0-9 ()-]*$/, "Digits, spaces, +, -, () only")
    .optional()
    .or(z.literal("")),
  bio: z.string().trim().max(280, "Max 280 characters").optional().or(z.literal("")),
});
type AdditionalValues = z.infer<typeof additionalSchema>;

const passwordFormSchema = z
  .object({
    password: passwordSchema,
    confirm: z.string(),
  })
  .refine((d) => d.password === d.confirm, {
    message: "Passwords don't match",
    path: ["confirm"],
  });
type PasswordFormValues = z.infer<typeof passwordFormSchema>;

function ProfilePage() {
  const { user } = useSession();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [avatarSignedUrl, setAvatarSignedUrl] = useState<string | null>(null);

  const profile = useQuery({
    enabled: !!user,
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, avatar_url, phone, bio")
        .eq("id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { register, handleSubmit, formState, reset } = useForm<ProfileValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { fullName: "" },
  });

  useEffect(() => {
    if (profile.data) reset({ fullName: profile.data.full_name ?? "" });
  }, [profile.data, reset]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!profile.data?.avatar_url) return setAvatarSignedUrl(null);
      const { data } = await supabase.storage
        .from("avatars")
        .createSignedUrl(profile.data.avatar_url, 3600);
      if (!cancelled) setAvatarSignedUrl(data?.signedUrl ?? null);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [profile.data?.avatar_url]);

  const saveProfile = useMutation({
    mutationFn: async (v: ProfileValues) => {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: v.fullName })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Profile updated");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadAvatar = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Not signed in");
      const ext = file.name.split(".").pop()?.toLowerCase() || "png";
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("profiles")
        .update({ avatar_url: path })
        .eq("id", user.id);
      if (dbErr) throw dbErr;
    },
    onSuccess: () => {
      toast.success("Avatar updated");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // --- Additional info (phone, bio) ---
  const additionalForm = useForm<AdditionalValues>({
    resolver: zodResolver(additionalSchema),
    defaultValues: { phone: "", bio: "" },
  });
  useEffect(() => {
    if (profile.data)
      additionalForm.reset({
        phone: (profile.data as { phone?: string | null }).phone ?? "",
        bio: (profile.data as { bio?: string | null }).bio ?? "",
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile.data]);

  const saveAdditional = useMutation({
    mutationFn: async (v: AdditionalValues) => {
      const { error } = await supabase
        .from("profiles")
        .update({ phone: v.phone || null, bio: v.bio || null })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Details saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // --- Change password ---
  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordFormSchema),
    defaultValues: { password: "", confirm: "" },
  });
  const changePassword = useMutation({
    mutationFn: async (v: PasswordFormValues) => {
      const { error } = await supabase.auth.updateUser({ password: v.password });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Password updated");
      passwordForm.reset({ password: "", confirm: "" });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // --- 2FA (TOTP) ---
  const factors = useQuery({
    enabled: !!user,
    queryKey: ["mfa-factors", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      return data;
    },
  });
  const verifiedTotp = factors.data?.totp?.find((f) => f.status === "verified");
  const [enrollment, setEnrollment] = useState<{
    factorId: string;
    qr: string;
    secret: string;
  } | null>(null);
  const [verifyCode, setVerifyCode] = useState("");
  const [disableMode, setDisableMode] = useState(false);
  const [disableCode, setDisableCode] = useState("");

  const startEnroll = useMutation({
    mutationFn: async () => {
      // Clean up any leftover unverified TOTP factors — Supabase rejects
      // a new enroll if a pending/unverified factor already exists.
      const { data: list } = await supabase.auth.mfa.listFactors();
      const stale = (list?.totp ?? []).filter((f) => f.status !== "verified");
      for (const f of stale) {
        await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Authenticator ${new Date().toISOString().slice(0, 10)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
        issuer: "Multi-tenant SaaS",
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setEnrollment({
        factorId: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const verifyEnroll = useMutation({
    mutationFn: async () => {
      if (!enrollment) throw new Error("No enrollment in progress");
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: enrollment.factorId,
      });
      if (cErr) throw cErr;
      const { error } = await supabase.auth.mfa.verify({
        factorId: enrollment.factorId,
        challengeId: challenge.id,
        code: verifyCode.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Two-factor authentication enabled");
      setEnrollment(null);
      setVerifyCode("");
      factors.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Cancel a pending (unverified) enrollment — AAL2 not required.
  const cancelEnrollment = useMutation({
    mutationFn: async (factorId: string) => {
      const { error } = await supabase.auth.mfa.unenroll({ factorId });
      if (error) throw error;
    },
    onSuccess: () => {
      setEnrollment(null);
      setVerifyCode("");
      factors.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Disable a VERIFIED factor. Supabase requires the session to reach AAL2,
  // so challenge + verify with the current TOTP code before unenrolling.
  const disableVerified = useMutation({
    mutationFn: async () => {
      if (!verifiedTotp) throw new Error("2FA is not enabled");
      if (disableCode.trim().length !== 6) throw new Error("Enter the 6-digit code");
      const { data: challenge, error: cErr } = await supabase.auth.mfa.challenge({
        factorId: verifiedTotp.id,
      });
      if (cErr) throw cErr;
      const { error: vErr } = await supabase.auth.mfa.verify({
        factorId: verifiedTotp.id,
        challengeId: challenge.id,
        code: disableCode.trim(),
      });
      if (vErr) throw vErr;
      const { error } = await supabase.auth.mfa.unenroll({ factorId: verifiedTotp.id });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Two-factor authentication disabled");
      setDisableMode(false);
      setDisableCode("");
      factors.refetch();
    },
    onError: (e: Error) => toast.error(e.message),
  });



  const initials = (profile.data?.full_name || user?.email || "?")
    .split(/\s+/)
    .map((s) => s[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Profile</h1>
        <p className="text-sm text-muted-foreground">Manage your account details.</p>
      </div>

      <section className="flex items-center gap-6 rounded-xl border bg-card p-6">
        <Avatar className="h-20 w-20">
          {avatarSignedUrl && <AvatarImage src={avatarSignedUrl} alt="Avatar" />}
          <AvatarFallback>{initials}</AvatarFallback>
        </Avatar>
        <div>
          <p className="font-medium">{profile.data?.full_name ?? user?.email}</p>
          <p className="text-sm text-muted-foreground">{user?.email}</p>
          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => fileRef.current?.click()}
              disabled={uploadAvatar.isPending}
            >
              {uploadAvatar.isPending ? "Uploading…" : "Upload avatar"}
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadAvatar.mutate(f);
                e.target.value = "";
              }}
            />
          </div>
        </div>
      </section>

      <form
        onSubmit={handleSubmit((v) => saveProfile.mutate(v))}
        className="space-y-4 rounded-xl border bg-card p-6"
      >
        <div>
          <Label htmlFor="fullName">Full name</Label>
          <Input id="fullName" {...register("fullName")} />
          {formState.errors.fullName && (
            <p className="mt-1 text-xs text-destructive">{formState.errors.fullName.message}</p>
          )}
        </div>
        <div>
          <Label htmlFor="email">Email</Label>
          <Input id="email" name="email" value={user?.email ?? ""} disabled />
        </div>
        <Button type="submit" disabled={saveProfile.isPending}>
          {saveProfile.isPending ? "Saving…" : "Save changes"}
        </Button>
      </form>

      <form
        onSubmit={additionalForm.handleSubmit((v) => saveAdditional.mutate(v))}
        className="space-y-4 rounded-xl border bg-card p-6"
      >
        <div>
          <h2 className="text-lg font-semibold">Additional info</h2>
          <p className="text-sm text-muted-foreground">Optional contact details and bio.</p>
        </div>
        <div>
          <Label htmlFor="phone">Phone</Label>
          <Input id="phone" placeholder="+1 555 000 1234" {...additionalForm.register("phone")} />
          {additionalForm.formState.errors.phone && (
            <p className="mt-1 text-xs text-destructive">
              {additionalForm.formState.errors.phone.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="bio">Bio</Label>
          <Textarea
            id="bio"
            rows={3}
            placeholder="A few words about you"
            {...additionalForm.register("bio")}
          />
          {additionalForm.formState.errors.bio && (
            <p className="mt-1 text-xs text-destructive">
              {additionalForm.formState.errors.bio.message}
            </p>
          )}
        </div>
        <Button type="submit" disabled={saveAdditional.isPending}>
          {saveAdditional.isPending ? "Saving…" : "Save details"}
        </Button>
      </form>

      <form
        onSubmit={passwordForm.handleSubmit((v) => changePassword.mutate(v))}
        className="space-y-4 rounded-xl border bg-card p-6"
      >
        <div>
          <h2 className="text-lg font-semibold">Change password</h2>
          <p className="text-sm text-muted-foreground">
            Choose a strong password with at least 8 characters, a letter, and a number.
          </p>
        </div>
        <div>
          <Label htmlFor="new-password">New password</Label>
          <Input id="new-password" type="password" {...passwordForm.register("password")} />
          {passwordForm.formState.errors.password && (
            <p className="mt-1 text-xs text-destructive">
              {passwordForm.formState.errors.password.message}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="confirm-password">Confirm new password</Label>
          <Input id="confirm-password" type="password" {...passwordForm.register("confirm")} />
          {passwordForm.formState.errors.confirm && (
            <p className="mt-1 text-xs text-destructive">
              {passwordForm.formState.errors.confirm.message}
            </p>
          )}
        </div>
        <Button type="submit" disabled={changePassword.isPending}>
          {changePassword.isPending ? "Updating…" : "Update password"}
        </Button>
      </form>

      <section className="space-y-4 rounded-xl border bg-card p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Two-factor authentication</h2>
            <p className="text-sm text-muted-foreground">
              Add a second step to sign-in using an authenticator app (TOTP).
            </p>
          </div>
          <Switch
            checked={!!verifiedTotp}
            disabled={
              factors.isLoading ||
              startEnroll.isPending ||
              cancelEnrollment.isPending ||
              disableVerified.isPending ||
              !!enrollment
            }
            onCheckedChange={(checked) => {
              if (checked && !verifiedTotp) {
                setDisableMode(false);
                startEnroll.mutate();
              } else if (!checked && verifiedTotp) {
                setDisableMode(true);
              }
            }}
          />
        </div>

        {verifiedTotp && !enrollment && !disableMode && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400">
            2FA is enabled on this account.
          </p>
        )}

        {verifiedTotp && disableMode && (
          <div className="space-y-3 rounded-lg border bg-background p-4">
            <p className="text-sm text-muted-foreground">
              Enter a 6-digit code from your authenticator app to confirm turning off 2FA.
            </p>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="totp-disable">Verification code</Label>
                <Input
                  id="totp-disable"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={disableCode}
                  onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <Button
                type="button"
                variant="destructive"
                onClick={() => disableVerified.mutate()}
                disabled={disableCode.length !== 6 || disableVerified.isPending}
              >
                {disableVerified.isPending ? "Disabling…" : "Disable 2FA"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setDisableMode(false);
                  setDisableCode("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}


        {enrollment && (
          <div className="space-y-3 rounded-lg border bg-background p-4">
            <p className="text-sm text-muted-foreground">
              Scan the QR code with your authenticator app, then enter the 6-digit code to confirm.
            </p>
            <div className="flex items-start gap-4">
              {/* Supabase returns an SVG data URL */}
              <img
                src={enrollment.qr}
                alt="TOTP QR code"
                className="h-40 w-40 rounded border bg-white p-2"
              />
              <div className="text-xs">
                <p className="text-muted-foreground">Or enter this secret manually:</p>
                <code className="mt-1 block break-all rounded bg-muted p-2 font-mono">
                  {enrollment.secret}
                </code>
              </div>
            </div>
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <Label htmlFor="totp">Verification code</Label>
                <Input
                  id="totp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={6}
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <Button
                type="button"
                onClick={() => verifyEnroll.mutate()}
                disabled={verifyCode.length !== 6 || verifyEnroll.isPending}
              >
                {verifyEnroll.isPending ? "Verifying…" : "Verify"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  if (enrollment) cancelEnrollment.mutate(enrollment.factorId);
                  setEnrollment(null);
                  setVerifyCode("");
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
