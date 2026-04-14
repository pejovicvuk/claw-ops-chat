"use client";

import { useState, FormEvent } from "react";
import { useRouter } from "next/navigation";
import { setToken } from "@/lib/auth";

export default function LoginPage() {
  const [token, setTokenValue] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      const base = process.env.NEXT_PUBLIC_BASE_PATH || "/chat";
      const res = await fetch(`${base}/api/auth/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: token.trim() }),
      });

      if (!res.ok) {
        setError("Invalid token");
        return;
      }

      setToken(token.trim());
      router.push("/");
    } catch {
      setError("Connection error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas-bg p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4"
      >
        <h1 className="text-center text-xl font-semibold text-canvas-fg">
          Claw Chat
        </h1>
        <p className="text-center text-sm text-canvas-muted">
          Enter your access token to continue
        </p>
        <input
          type="password"
          value={token}
          onChange={(e) => setTokenValue(e.target.value)}
          placeholder="Access token"
          autoFocus
          className="w-full rounded-lg border border-canvas-border bg-canvas-bg px-4 py-3 text-canvas-fg placeholder:text-canvas-muted focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {error && (
          <p className="text-center text-sm text-red-500">{error}</p>
        )}
        <button
          type="submit"
          disabled={!token.trim() || loading}
          className="w-full rounded-lg bg-[#1f6feb] px-4 py-3 font-medium text-white disabled:opacity-50"
        >
          {loading ? "Verifying..." : "Continue"}
        </button>
      </form>
    </div>
  );
}
