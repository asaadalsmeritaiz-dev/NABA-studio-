import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Globe, LogOut, ShieldCheck, X } from 'lucide-react';
import type { ProviderCapability, StudioLocale, StudioUser } from '../types/studio.ts';
import { t } from '../i18n/strings.ts';

interface Props {
  open: boolean;
  locale: StudioLocale;
  user: StudioUser;
  capabilities: ProviderCapability[];
  onClose: () => void;
  onSetLocale: (locale: StudioLocale) => void;
  onSignOut: () => void;
}

export function SettingsModal({
  open,
  locale,
  user,
  capabilities,
  onClose,
  onSetLocale,
  onSignOut,
}: Props) {
  const s = t(locale);
  const isAr = locale === 'ar';
  const [showTechMatrix, setShowTechMatrix] = useState(false);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-[#180E15]/80 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="settings-modal-title"
    >
      <div className="w-full max-w-xl max-h-[88vh] overflow-y-auto rounded-2xl border border-[#654354] bg-[#27131F] p-6 space-y-6">
        <div className="flex items-center justify-between gap-3">
          <h2 id="settings-modal-title" className="text-lg font-bold text-[#F9F1F4]">
            {s.settingsTitle}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={s.close}
            className="p-2 rounded-xl text-[#C8B7C0] hover:text-[#F9F1F4] hover:bg-[#341A29] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Account Summary */}
        <section className="rounded-xl border border-[#654354]/70 bg-[#180E15] p-4 flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs text-[#C8B7C0]">{s.settingsAccount}</p>
            <p className="text-sm font-bold text-[#F9F1F4] truncate mt-0.5">{user.name}</p>
            <p className="text-xs text-[#C8B7C0] truncate" dir="ltr">
              {user.email}
            </p>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-[#F07883]/40 text-[#F07883] hover:bg-[#F07883]/10 text-xs font-semibold transition-colors whitespace-nowrap shrink-0"
          >
            <LogOut className="w-4 h-4" />
            {s.navSignOut}
          </button>
        </section>

        {/* Interface Language */}
        <section className="space-y-2.5">
          <div className="flex items-center gap-2 text-sm font-semibold text-[#F9F1F4]">
            <Globe className="w-4 h-4 text-[#C49A6C]" />
            <span>{s.settingsLanguage}</span>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              onClick={() => onSetLocale('ar')}
              className={`py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors ${
                locale === 'ar'
                  ? 'border-[#C49A6C] bg-[#78263F] text-[#F9F1F4]'
                  : 'border-[#654354] bg-[#180E15] text-[#C8B7C0] hover:text-[#F9F1F4]'
              }`}
            >
              العربية (RTL)
            </button>
            <button
              type="button"
              onClick={() => onSetLocale('en')}
              className={`py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors ${
                locale === 'en'
                  ? 'border-[#C49A6C] bg-[#78263F] text-[#F9F1F4]'
                  : 'border-[#654354] bg-[#180E15] text-[#C8B7C0] hover:text-[#F9F1F4]'
              }`}
            >
              English (LTR)
            </button>
          </div>
        </section>

        {/* Progressive Disclosure: System Capabilities & Provider Transparency */}
        <section className="rounded-xl border border-[#654354]/70 bg-[#180E15] overflow-hidden">
          <button
            type="button"
            onClick={() => setShowTechMatrix((v) => !v)}
            className="w-full px-4 py-3.5 flex items-center justify-between gap-3 text-sm font-semibold text-[#F9F1F4] hover:bg-[#341A29]/60 transition-colors"
          >
            <span className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#C49A6C]" />
              {s.settingsCapabilities}
            </span>
            {showTechMatrix ? (
              <ChevronUp className="w-4 h-4 text-[#C8B7C0]" />
            ) : (
              <ChevronDown className="w-4 h-4 text-[#C8B7C0]" />
            )}
          </button>

          {showTechMatrix && (
            <div className="border-t border-[#654354]/60 divide-y divide-[#654354]/40">
              {capabilities.map((cap) => (
                <div key={cap.id} className="px-4 py-3 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[#F9F1F4]">
                      {isAr ? cap.display_name_ar : cap.display_name}
                    </span>
                    <span
                      className={`text-xs font-semibold whitespace-nowrap ${
                        cap.available ? 'text-[#49B894]' : 'text-[#E7B66A]'
                      }`}
                    >
                      {isAr ? cap.status_label_ar : cap.status_label_en}
                    </span>
                  </div>
                  <p className="text-xs text-[#C8B7C0] leading-relaxed">
                    {isAr ? cap.limitation_note_ar : cap.limitation_note_en}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
