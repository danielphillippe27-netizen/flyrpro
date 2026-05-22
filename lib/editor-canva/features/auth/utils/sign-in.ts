"use client";

type SignInOptions = {
  callbackUrl?: string;
  email?: string;
  password?: string;
};

export function signIn(provider: "credentials" | "github" | "google", options: SignInOptions = {}) {
  if (typeof window === "undefined") return;

  const callbackUrl = options.callbackUrl || "/";
  if (provider === "credentials") {
    window.location.assign(callbackUrl);
    return;
  }

  const params = new URLSearchParams({ callbackUrl });
  window.location.assign(`/api/auth/signin/${provider}?${params.toString()}`);
}
