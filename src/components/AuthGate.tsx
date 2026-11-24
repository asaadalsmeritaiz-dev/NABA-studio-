import React, { useState } from 'react';
import { Globe, KeyRound, Lock, LogIn, ShieldCheck, UserPlus, Video } from 'lucide-react';
import type { AuthStatus, StudioLocale } from '../types/studio.ts';
import { studioApi, type AuthSessionResponse } from '../lib/api.ts';

interface Props {
  locale: StudioLocale;
  authStatus: AuthStatus;
  onToggleLocale: () => void;
  onAuthenticated: (session: AuthSessionResponse) => void;
}

export function AuthGate({ locale, authStatus, onToggleLocale, onAuthenticated }: Props) {
  const isAr = locale === 'ar';
  const [mode, setMode] = useState<'claim' | 'login' | 'register'>(
    authStatus.claim_required ? 'claim' : 'login',
  );
  const [email, setEmail] = useState(authStatus.default_email || 'instructor@naba.academy');
  const [name, setName] = useState(isAr ? 'د. طارق المنصور' : 'Dr. Tariq Al-Mansour');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      let session: AuthSessionResponse;
      if (mode === 'claim') {
        session = await studioApi.claimWorkspace({ password, name: name.trim() || undefined });
      } else if (mode === 'register') {
        session = await studioApi.register({ email: email.trim(), name: name.trim(), password, locale });
      } else {
        session = await studioApi.login({ email: email.trim(), password });
      }
      onAuthenticated(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : isAr ? 'تعذر إتمام تسجيل الدخول' : 'Authentication failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      dir={isAr ? 'rtl' : 'ltr'}
      className="min-h-screen bg-[#180E15] text-[#F9F1F4] flex flex-col justify-between p-5 sm:p-8"
    >
      {/* Top minimal bar */}
      <div className="max-w-5xl w-full mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-[#3B0D1E] border border-[#C49A6C]/40 flex items-center justify-center">
            <Video className="w-5 h-5 text-[#C49A6C]" />
          </div>
          <div>
            <p className="text-base font-bold tracking-tight text-[#F9F1F4]">
              {isAr ? 'أستوديو نبأ' : 'Naba Studio'}
            </p>
            <p className="text-xs text-[#C8B7C0]">
              {isAr ? 'أكاديمية نبأ · إنتاج الفيديو التعليمي' : 'Naba Academy · Educational Video Studio'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleLocale}
          className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#654354] bg-[#27131F] hover:bg-[#341A29] text-xs font-semibold text-[#F9F1F4] transition-colors whitespace-nowrap shrink-0"
        >
          <Globe className="w-4 h-4 text-[#C49A6C]" />
          {isAr ? 'English' : 'العربية'}
        </button>
      </div>

      {/* Centered Auth Card */}
      <main className="w-full max-w-md mx-auto my-8">
        <div className="rounded-2xl border border-[#654354] bg-[#27131F] p-6 sm:p-8 space-y-6">
          <div className="space-y-2 text-center">
            <div className="w-12 h-12 rounded-2xl bg-[#3B0D1E] border border-[#C49A6C]/35 mx-auto flex items-center justify-center">
              {mode === 'claim' ? (
                <ShieldCheck className="w-6 h-6 text-[#C49A6C]" />
              ) : mode === 'register' ? (
                <UserPlus className="w-6 h-6 text-[#C49A6C]" />
              ) : (
                <KeyRound className="w-6 h-6 text-[#C49A6C]" />
              )}
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-[#F9F1F4]">
              {mode === 'claim'
                ? isAr
                  ? 'تأمين مساحة عمل الأستوديو'
                  : 'Secure Your Studio Workspace'
                : mode === 'register'
                  ? isAr
                    ? 'إنشاء حساب معلّم جديد'
                    : 'Create Instructor Account'
                  : isAr
                    ? 'تسجيل الدخول إلى أستوديو نبأ'
                    : 'Sign In to Naba Studio'}
            </h1>
            <p className="text-sm text-[#C8B7C0] leading-relaxed">
              {mode === 'claim'
                ? isAr
                  ? 'اختر كلمة مرور لحماية مشاريعك الدروسية والملفات المصدّرة في هذه المساحة.'
                  : 'Set a password to protect your lesson projects and exported videos.'
                : mode === 'register'
                  ? isAr
                    ? 'أنشئ مساحة خاصة بك لإنتاج فيديوهاتك التعليمية.'
                    : 'Create your private workspace for educational video production.'
                  : isAr
                    ? 'أدخل بياناتك للمتابعة إلى مشاريعك التعليمية.'
                    : 'Enter your credentials to access your studio projects.'}
            </p>
          </div>

          {!authStatus.claim_required && (
            <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-[#180E15] border border-[#654354]/60">
              <button
                type="button"
                onClick={() => {
                  setMode('login');
                  setError(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  mode === 'login'
                    ? 'bg-[#78263F] text-[#F9F1F4]'
                    : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
                }`}
              >
                {isAr ? 'تسجيل الدخول' : 'Sign In'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setMode('register');
                  setError(null);
                }}
                className={`py-2 px-3 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                  mode === 'register'
                    ? 'bg-[#78263F] text-[#F9F1F4]'
                    : 'text-[#C8B7C0] hover:text-[#F9F1F4]'
                }`}
              >
                {isAr ? 'حساب جديد' : 'New Account'}
              </button>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {(mode === 'claim' || mode === 'register') && (
              <div>
                <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                  {isAr ? 'الاسم الكامل' : 'Full Name'}
                </label>
                <input
                  type="text"
                  required
                  minLength={2}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-4 py-3 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:border-[#C49A6C] focus:outline-none"
                />
              </div>
            )}

            {mode !== 'claim' && (
              <div>
                <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                  {isAr ? 'البريد الإلكتروني' : 'Email Address'}
                </label>
                <input
                  type="email"
                  required
                  dir="ltr"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-4 py-3 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:border-[#C49A6C] focus:outline-none"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-[#C8B7C0] mb-1.5">
                {isAr ? 'كلمة المرور' : 'Password'}
              </label>
              <div className="relative">
                <input
                  type="password"
                  required
                  minLength={mode === 'login' ? 4 : 8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === 'login' ? '••••••••' : isAr ? '8 أحرف على الأقل' : 'Minimum 8 characters'}
                  className="w-full rounded-xl border border-[#654354] bg-[#180E15] px-4 py-3 text-sm text-[#F9F1F4] placeholder-[#C8B7C0]/50 focus:border-[#C49A6C] focus:outline-none"
                />
                <Lock className={`w-4 h-4 text-[#C8B7C0]/60 absolute top-3.5 ${isAr ? 'left-3.5' : 'right-3.5'}`} />
              </div>
            </div>

            {error && (
              <div className="rounded-xl border border-[#F07883]/40 bg-[#F07883]/10 px-4 py-3 text-xs text-[#F07883]">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full inline-flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-[#78263F] hover:bg-[#9E4761] disabled:opacity-60 text-[#F9F1F4] text-sm font-bold transition-colors whitespace-nowrap"
            >
              <LogIn className="w-4 h-4" />
              {busy
                ? isAr
                  ? 'جاري التحقق...'
                  : 'Signing in...'
                : mode === 'claim'
                  ? isAr
                    ? 'حفظ كلمة المرور والدخول'
                    : 'Set Password & Enter Studio'
                  : mode === 'register'
                    ? isAr
                      ? 'إنشاء الحساب'
                      : 'Create Account'
                    : isAr
                      ? 'دخول إلى الأستوديو'
                      : 'Enter Studio'}
            </button>
          </form>
        </div>
      </main>

      <footer className="text-center text-xs text-[#C8B7C0]/70">
        {isAr ? 'أكاديمية نبأ · جميع مشاريعك محمية وخاصة بحسابك' : 'Naba Academy · Your lessons and exports remain private to your account'}
      </footer>
    </div>
  );
}
