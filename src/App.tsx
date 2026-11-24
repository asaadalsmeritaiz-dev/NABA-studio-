import React, { Suspense, useCallback, useEffect, useState } from 'react';
import {
  Film,
  FolderOpen,
  Home,
  Loader2,
  LogOut,
  PlusCircle,
  Settings,
  User,
  Video,
} from 'lucide-react';
import type {
  AuthStatus,
  ClassroomEnvironment,
  ExportedVideo,
  Lecturer,
  ProjectSummary,
  ProviderCapability,
  StudioLocale,
  StudioUser,
  VoiceProfile,
} from './types/studio.ts';
import { t } from './i18n/strings.ts';
import {
  clearSessionTokens,
  setSessionTokens,
  setUnauthorizedHandler,
  studioApi,
  type AuthSessionResponse,
} from './lib/api.ts';
import { AuthGate } from './components/AuthGate.tsx';
import { HomePage } from './components/HomePage.tsx';
import { MyVideosPage } from './components/MyVideosPage.tsx';
import { LecturersLibrary } from './components/LecturersLibrary.tsx';
import { SettingsModal } from './components/SettingsModal.tsx';

const CreationWizard = React.lazy(() =>
  import('./components/CreationWizard.tsx').then((m) => ({ default: m.CreationWizard })),
);
const VideoEditor = React.lazy(() =>
  import('./components/VideoEditor.tsx').then((m) => ({ default: m.VideoEditor })),
);

type NavView = 'home' | 'my_videos' | 'create' | 'library' | 'editor';

export default function App() {
  const [locale, setLocale] = useState<StudioLocale>('ar');
  const [view, setView] = useState<NavView>('home');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Quick-launch handoff from Home -> Create Wizard
  const [wizardSeedTopic, setWizardSeedTopic] = useState('');
  const [wizardSeedFile, setWizardSeedFile] = useState<File | null>(null);
  const [wizardKey, setWizardKey] = useState(0);

  // Preferred defaults picked in Library
  const [preferredLecturerId, setPreferredLecturerId] = useState('lec-tariq');
  const [preferredVoiceId, setPreferredVoiceId] = useState('voice-ar-tariq');
  const [preferredEnvironmentId, setPreferredEnvironmentId] = useState('env-lecture-hall');

  // Auth
  const [authLoading, setAuthLoading] = useState(true);
  const [authStatus, setAuthStatus] = useState<AuthStatus | null>(null);
  const [currentUser, setCurrentUser] = useState<StudioUser | null>(null);

  // Workspace data
  const [loadingData, setLoadingData] = useState(false);
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [exportsList, setExportsList] = useState<
    Array<ExportedVideo & { subject?: string; download_url?: string }>
  >([]);
  const [lecturers, setLecturers] = useState<Lecturer[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [environments, setEnvironments] = useState<ClassroomEnvironment[]>([]);
  const [capabilities, setCapabilities] = useState<ProviderCapability[]>([]);

  // Profile menu & Settings modal
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const s = t(locale);
  const isAr = locale === 'ar';

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
  }, [locale]);

  const checkAuthStatus = useCallback(async () => {
    try {
      const status = await studioApi.getAuthStatus();
      setAuthStatus(status);
      setCurrentUser(status.authenticated ? status.user : null);
    } catch {
      setAuthStatus({
        authenticated: false,
        claim_required: false,
        passcode_configured: false,
        default_email: 'instructor@naba.academy',
        user: null,
      });
      setCurrentUser(null);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setCurrentUser(null);
      void checkAuthStatus();
    });
    void checkAuthStatus();
    return () => setUnauthorizedHandler(null);
  }, [checkAuthStatus]);

  const refreshWorkspace = useCallback(async () => {
    if (!currentUser) return;
    setLoadingData(true);
    try {
      const [capRes, projRes, expRes] = await Promise.all([
        studioApi.getCapabilities(),
        studioApi.listProjects(),
        studioApi.listExports(),
      ]);
      setCapabilities(capRes.capabilities);
      setLecturers(capRes.lecturers);
      setVoices(capRes.voices);
      setEnvironments(capRes.environments);
      setProjects(projRes.projects);
      setExportsList(expRes.exports);
    } catch {
      // Handled by unauthorized handler or individual view
    } finally {
      setLoadingData(false);
    }
  }, [currentUser]);

  useEffect(() => {
    if (currentUser) {
      void refreshWorkspace();
    }
  }, [currentUser, refreshWorkspace]);

  function handleAuthenticated(session: AuthSessionResponse) {
    setSessionTokens(session.token, session.media_token);
    setCurrentUser(session.user);
    if (session.user.locale === 'ar' || session.user.locale === 'en') {
      setLocale(session.user.locale);
    }
    setAuthStatus({
      authenticated: true,
      claim_required: false,
      passcode_configured: true,
      default_email: session.user.email,
      user: session.user,
    });
  }

  async function handleSignOut() {
    setProfileMenuOpen(false);
    setSettingsOpen(false);
    try {
      await studioApi.logout();
    } catch {
      clearSessionTokens();
    }
    setCurrentUser(null);
    setProjects([]);
    setExportsList([]);
    await checkAuthStatus();
  }

  function startCreateFlow(initialTopic = '', initialFile: File | null = null) {
    setWizardSeedTopic(initialTopic);
    setWizardSeedFile(initialFile);
    setWizardKey((k) => k + 1);
    setView('create');
  }

  function openProjectEditor(projectId: string) {
    setActiveProjectId(projectId);
    setView('editor');
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#180E15] flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-[#C49A6C]" />
      </div>
    );
  }

  if (!currentUser && authStatus) {
    return (
      <AuthGate
        locale={locale}
        authStatus={authStatus}
        onToggleLocale={() => setLocale((l) => (l === 'ar' ? 'en' : 'ar'))}
        onAuthenticated={handleAuthenticated}
      />
    );
  }

  const navItems: Array<{ id: Exclude<NavView, 'editor'>; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { id: 'home', label: s.navHome, icon: Home },
    { id: 'my_videos', label: s.navMyVideos, icon: Film },
    { id: 'create', label: s.navCreate, icon: PlusCircle },
    { id: 'library', label: s.navLibrary, icon: FolderOpen },
  ];

  const activeNavId: NavView = view === 'editor' ? 'my_videos' : view;

  return (
    <div dir={isAr ? 'rtl' : 'ltr'} className="min-h-screen bg-[#180E15] text-[#F9F1F4] flex">
      {/* Desktop Compact Sidebar (4 primary items + Profile Menu) */}
      <aside className="hidden md:flex md:w-60 lg:w-64 shrink-0 flex-col justify-between bg-[#3B0D1E] border-e border-[#654354]/60 sticky top-0 h-screen p-4">
        <div className="space-y-8">
          {/* Brand Identity */}
          <button
            type="button"
            onClick={() => setView('home')}
            className="w-full flex items-center gap-3 px-2 py-1 text-start"
          >
            <div className="w-10 h-10 rounded-xl bg-[#581629] border border-[#C49A6C]/45 flex items-center justify-center shrink-0">
              <Video className="w-5 h-5 text-[#C49A6C]" />
            </div>
            <div className="min-w-0">
              <p className="text-base font-extrabold text-[#F9F1F4] tracking-tight truncate">
                {s.brandName}
              </p>
              <p className="text-[11px] text-[#C8B7C0] truncate">{s.brandSub}</p>
            </div>
          </button>

          {/* 4 Primary Navigation Destinations */}
          <nav className="space-y-1.5" aria-label="Primary Navigation">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNavId === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    if (item.id === 'create') {
                      startCreateFlow('', null);
                    } else {
                      setView(item.id);
                    }
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-bold transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#78263F] text-[#F9F1F4]'
                      : 'text-[#C8B7C0] hover:bg-[#581629]/70 hover:text-[#F9F1F4]'
                  }`}
                >
                  <Icon
                    className={`w-4 h-4 shrink-0 ${isActive ? 'text-[#C49A6C]' : 'text-[#C8B7C0]'}`}
                  />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* Bottom Profile Menu (Contains Settings & Sign Out) */}
        <div className="relative pt-4 border-t border-[#654354]/50">
          {profileMenuOpen && (
            <div className="absolute bottom-16 inset-x-0 rounded-xl border border-[#654354] bg-[#27131F] p-1.5 shadow-xl space-y-1">
              <button
                type="button"
                onClick={() => {
                  setProfileMenuOpen(false);
                  setSettingsOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#F9F1F4] hover:bg-[#581629] transition-colors"
              >
                <Settings className="w-4 h-4 text-[#C49A6C]" />
                {s.navSettings}
              </button>
              <button
                type="button"
                onClick={() => void handleSignOut()}
                className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-semibold text-[#F07883] hover:bg-[#581629] transition-colors"
              >
                <LogOut className="w-4 h-4" />
                {s.navSignOut}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setProfileMenuOpen((v) => !v)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-[#581629]/80 transition-colors text-start"
          >
            <div className="w-9 h-9 rounded-full bg-[#581629] border border-[#C49A6C]/40 flex items-center justify-center shrink-0">
              <User className="w-4 h-4 text-[#C49A6C]" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-xs font-bold text-[#F9F1F4] truncate">{currentUser?.name}</p>
              <p className="text-[11px] text-[#C8B7C0] truncate">{s.navSettings}</p>
            </div>
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col min-h-screen pb-16 md:pb-0">
        {/* Minimal Mobile Header (visible < md) */}
        <header className="md:hidden h-14 px-4 bg-[#3B0D1E] border-b border-[#654354]/60 flex items-center justify-between sticky top-0 z-30">
          <button
            type="button"
            onClick={() => setView('home')}
            className="flex items-center gap-2.5"
          >
            <Video className="w-5 h-5 text-[#C49A6C]" />
            <span className="text-sm font-extrabold text-[#F9F1F4]">{s.brandName}</span>
          </button>
          <button
            type="button"
            onClick={() => setSettingsOpen(true)}
            aria-label={s.navSettings}
            className="p-2 rounded-xl bg-[#581629] text-[#F9F1F4]"
          >
            <Settings className="w-4 h-4 text-[#C49A6C]" />
          </button>
        </header>

        <main className="flex-1">
          {view === 'home' && (
            <HomePage
              locale={locale}
              projects={projects}
              lecturers={lecturers}
              environments={environments}
              loading={loadingData}
              onStartCreate={(topic, file) => startCreateFlow(topic, file ?? null)}
              onOpenProject={openProjectEditor}
              onGoMyVideos={() => setView('my_videos')}
            />
          )}

          {view === 'my_videos' && (
            <MyVideosPage
              locale={locale}
              projects={projects}
              exportsList={exportsList}
              lecturers={lecturers}
              environments={environments}
              loading={loadingData}
              onCreateNew={() => startCreateFlow('', null)}
              onOpenProject={openProjectEditor}
              onRefresh={refreshWorkspace}
            />
          )}

          {view === 'create' && (
            <Suspense
              fallback={
                <div className="py-20 flex items-center justify-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#C49A6C]" />
                </div>
              }
            >
              <CreationWizard
                key={wizardKey}
                locale={locale}
                lecturers={lecturers}
                voices={voices}
                environments={environments}
                initialTopic={wizardSeedTopic}
                initialFile={wizardSeedFile}
                defaultLecturerId={preferredLecturerId}
                defaultVoiceId={preferredVoiceId}
                defaultEnvironmentId={preferredEnvironmentId}
                onProjectReady={openProjectEditor}
                onRefreshProjects={refreshWorkspace}
              />
            </Suspense>
          )}

          {view === 'library' && (
            <LecturersLibrary
              locale={locale}
              lecturers={lecturers}
              voices={voices}
              environments={environments}
              preferredLecturerId={preferredLecturerId}
              preferredVoiceId={preferredVoiceId}
              preferredEnvironmentId={preferredEnvironmentId}
              onSelectLecturer={setPreferredLecturerId}
              onSelectVoice={setPreferredVoiceId}
              onSelectEnvironment={setPreferredEnvironmentId}
              onLecturerAdded={refreshWorkspace}
            />
          )}

          {view === 'editor' && activeProjectId && (
            <Suspense
              fallback={
                <div className="py-20 flex items-center justify-center">
                  <Loader2 className="w-7 h-7 animate-spin text-[#C49A6C]" />
                </div>
              }
            >
              <VideoEditor
                locale={locale}
                projectId={activeProjectId}
                lecturers={lecturers}
                voices={voices}
                environments={environments}
                onBack={() => setView('my_videos')}
                onProjectUpdated={refreshWorkspace}
              />
            </Suspense>
          )}
        </main>
      </div>

      {/* Compact Mobile Bottom Navigation (4 destinations, h-16 <= 10% viewport) */}
      <nav
        aria-label="Mobile Navigation"
        className="md:hidden fixed bottom-0 inset-x-0 h-16 bg-[#3B0D1E] border-t border-[#654354]/70 z-30 grid grid-cols-4"
      >
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeNavId === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => {
                if (item.id === 'create') {
                  startCreateFlow('', null);
                } else {
                  setView(item.id);
                }
              }}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-bold transition-colors ${
                isActive ? 'text-[#C49A6C]' : 'text-[#C8B7C0]'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="truncate max-w-full px-1">{item.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Profile Settings Modal */}
      {currentUser && (
        <SettingsModal
          open={settingsOpen}
          locale={locale}
          user={currentUser}
          capabilities={capabilities}
          onClose={() => setSettingsOpen(false)}
          onSetLocale={setLocale}
          onSignOut={() => void handleSignOut()}
        />
      )}
    </div>
  );
}
