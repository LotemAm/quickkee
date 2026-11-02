import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowUpRight, Check, FilePlus, FolderOpen, LockKeyhole } from 'lucide-react';
import { CreateDatabase } from '../../shared/CreateDatabase';
import { UnlockScreen } from '../../shared/UnlockScreen';
import { loadSettings } from '../../shared/settings';
import { applyTheme } from '../../shared/theme';

type Screen = 'welcome' | 'create' | 'open' | 'ready';

export function Welcome() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [notice, setNotice] = useState<string>();
  const lastChoice = useRef<'create' | 'open' | null>(null);
  const createAction = useRef<HTMLButtonElement>(null);
  const openAction = useRef<HTMLButtonElement>(null);
  const readyHeading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { void loadSettings().then(settings => applyTheme(settings.theme)); }, []);
  useEffect(() => {
    if (screen === 'ready') readyHeading.current?.focus();
    if (screen === 'welcome' && lastChoice.current) {
      (lastChoice.current === 'create' ? createAction : openAction).current?.focus();
    }
  }, [screen]);

  function chooseDatabase(choice: 'create' | 'open') {
    lastChoice.current = choice;
    setScreen(choice);
  }

  function databaseReady(unlockNotice?: string) {
    setNotice(unlockNotice);
    setScreen('ready');
  }

  return (
    <div className="welcome-page">
      <header className="welcome-header">
        <div className="welcome-brand">
          <img src={chrome.runtime.getURL('icon-128.png')} alt="" width={34} height={34} />
          <span>QuickKee</span>
        </div>
        <span className="welcome-header-note">Your KeePass companion for the browser</span>
      </header>

      <main className="welcome-main">
        {screen === 'welcome' && (
          <div className="welcome-home">
            <div className="welcome-introduction">
              <div className="welcome-mark" aria-hidden="true"><LockKeyhole size={30} strokeWidth={1.7} /></div>
              <h1 className="welcome-title">Welcome to QuickKee</h1>
              <p className="welcome-lead">Let’s give your passwords a home.</p>
            </div>

            <div className="welcome-actions">
              <button ref={createAction} className="welcome-action welcome-action-primary" type="button"
                onClick={() => chooseDatabase('create')}>
                <FilePlus className="welcome-action-icon" size={29} strokeWidth={1.7} aria-hidden="true" />
                <span className="welcome-action-content">
                  <span className="welcome-action-title">Create database</span>
                  <span className="welcome-action-description">Start fresh with an encrypted password file.</span>
                </span>
                <ArrowRight size={20} aria-hidden="true" />
              </button>
              <button ref={openAction} className="welcome-action welcome-action-secondary" type="button"
                onClick={() => chooseDatabase('open')}>
                <FolderOpen className="welcome-action-icon" size={29} strokeWidth={1.7} aria-hidden="true" />
                <span className="welcome-action-content">
                  <span className="welcome-action-title">Open existing database</span>
                  <span className="welcome-action-description">Use a KeePass .kdbx file you already have.</span>
                </span>
                <ArrowRight size={20} aria-hidden="true" />
              </button>
            </div>

            <section className="welcome-explainer" aria-labelledby="keepass-title">
              <h2 id="keepass-title">What is KeePass?</h2>
              <p>KeePass is a free, open-source password manager that stores your passwords in an encrypted database.
                {' '}QuickKee lets you use that database right in your browser.</p>
              <a className="welcome-learn" href="https://keepass.info/" target="_blank" rel="noopener noreferrer">
                More about KeePass <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            </section>
          </div>
        )}

        {(screen === 'create' || screen === 'open') && (
          <div className="welcome-flow">
            <button type="button" className="welcome-back" onClick={() => setScreen('welcome')}>
              <ArrowLeft size={17} aria-hidden="true" /> Back to welcome
            </button>
            {screen === 'create'
              ? <CreateDatabase onCreated={databaseReady} onCancel={() => setScreen('welcome')} />
              : <UnlockScreen onUnlocked={databaseReady} />}
          </div>
        )}

        {screen === 'ready' && (
          <section className="welcome-ready" aria-labelledby="ready-title">
            <div className="welcome-mark" aria-hidden="true"><Check size={30} /></div>
            <h1 id="ready-title" ref={readyHeading} tabIndex={-1} className="welcome-title">Your database is ready</h1>
            <p className="welcome-lead">You can now save, find, and autofill your passwords with QuickKee.</p>
            {notice && <p role="status" className="alert-error">{notice}</p>}
            <a className="welcome-continue" href={chrome.runtime.getURL('src/pages/panel/index.html')}>
              Open database <ArrowRight size={19} aria-hidden="true" />
            </a>
          </section>
        )}
      </main>

      <footer className="welcome-footer">Local file · Dropbox · Google Drive</footer>
    </div>
  );
}
