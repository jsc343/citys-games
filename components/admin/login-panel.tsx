"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { errorReason, postJson } from "@/lib/client-api";

const MESSAGES: Record<string, string> = {
  not_admin: "此信箱不是管理員信箱，無法進入後台",
  needs_setup: "此帳號尚未設定密碼，請使用「首次登入 / 忘記密碼」",
  bad_password: "密碼不正確",
  rate_limit: "嘗試次數過多，請 15 分鐘後再試",
  too_soon: "驗證碼剛寄出，請稍候 30 秒再重新取得",
  invalid_code: "驗證碼不正確或已過期",
  weak_password: "密碼至少需要 8 個字元",
  not_configured: "後台尚未設定管理員金鑰，請先在專案變數中加入 ADMIN_SETUP_KEY",
};

type Mode = "login" | "verify";

export function LoginPanel({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [devCode, setDevCode] = useState<string | null>(null);

  const fail = (e: unknown) => toast.error(MESSAGES[errorReason(e)] ?? "操作失敗，請稍後再試");

  const login = async () => {
    setBusy(true);
    try {
      await postJson("/api/admin/login", { email, password });
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const requestCode = async () => {
    setBusy(true);
    try {
      const res = await postJson<{ ok: boolean; sent?: boolean; devCode?: string }>(
        "/api/admin/request-code",
        { email },
      );
      setCodeSent(true);
      setDevCode(res.devCode ?? null);
      toast.success("若此信箱為管理員信箱，驗證碼已寄出");
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const setNewPassword = async () => {
    setBusy(true);
    try {
      await postJson("/api/admin/set-password", { email, code, password });
      toast.success("密碼已設定");
      onDone();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-5 px-4 py-10">
      <div>
        <h1 className="text-2xl font-black">商家管理後台</h1>
        <p className="text-sm text-muted-foreground">City&apos;s Games(2) · 僅限指定管理員信箱</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="adm-email" className="text-sm font-bold">
          管理員信箱
        </label>
        <Input
          id="adm-email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>

      {mode === "login" ? (
        <>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="adm-pass" className="text-sm font-bold">
              密碼
            </label>
            <Input
              id="adm-pass"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing && e.keyCode !== 229 && email && password) login();
              }}
            />
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            尚未設定密碼或收不到驗證碼時，可直接在密碼欄輸入「管理員金鑰」登入。
          </p>
          <Button size="lg" disabled={busy || !email || !password} onClick={login}>
            登入
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              setMode("verify");
              setPassword("");
            }}
          >
            首次登入 / 忘記密碼
          </Button>
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed text-muted-foreground">
            先以信箱取得驗證碼（也可在驗證碼欄輸入管理員金鑰），再設定新密碼（至少 8 個字元）。
          </p>
          <Button variant="secondary" disabled={busy || !email} onClick={requestCode}>
            {codeSent ? "重新寄送驗證碼" : "寄送驗證碼"}
          </Button>
          {devCode && (
            <p className="rounded-lg border border-border bg-card p-3 text-sm">
              測試環境尚未設定郵件服務，驗證碼：<span className="font-black text-primary">{devCode}</span>
            </p>
          )}
          {codeSent && (
            <>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="adm-code" className="text-sm font-bold">
                  驗證碼
                </label>
                <Input
                  id="adm-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="adm-newpass" className="text-sm font-bold">
                  新密碼
                </label>
                <Input
                  id="adm-newpass"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button size="lg" disabled={busy || code.length < 6 || password.length < 8} onClick={setNewPassword}>
                設定密碼並登入
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={() => setMode("login")}>
            返回登入
          </Button>
        </>
      )}
    </main>
  );
}
