import type { CredentialPromptMetadata } from '../shared/messages';
import { loadSettings } from '../shared/settings';
import { CREDENTIAL_CAPTURE_TTL_MS } from '../shared/credentialCapture';
import { resolvesDark, shadowPalette } from './shadowPalette';

export interface CredentialPromptCommit {
  captureId: string;
  entryId?: string;
  saveAsNew?: boolean;
}

export interface CredentialPromptHandlers {
  commit(request: CredentialPromptCommit): Promise<boolean>;
  dismiss(captureId: string): Promise<void> | void;
}

interface CredentialPromptOptions {
  doc?: Document;
  trustedAction?: (event: Event) => boolean;
}

export class CredentialPrompt {
  private readonly doc: Document;
  private readonly trustedAction: (event: Event) => boolean;
  private host: HTMLElement | null = null;
  private root: ShadowRoot | null = null;
  private metadata: CredentialPromptMetadata | null = null;
  private handlers: CredentialPromptHandlers | null = null;
  private dark = false;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: CredentialPromptOptions = {}) {
    this.doc = options.doc ?? document;
    this.trustedAction = options.trustedAction ?? (event => event.isTrusted);
    void loadSettings().then(settings => {
      this.dark = resolvesDark(settings.theme, this.doc.defaultView);
      if (this.root && this.metadata && this.handlers) this.render(this.metadata, this.handlers);
    }).catch(() => {});
  }

  show(metadata: CredentialPromptMetadata, handlers: CredentialPromptHandlers): void {
    this.hide();
    const host = this.doc.createElement('div');
    host.setAttribute('data-quickkee-credential-prompt', 'true');
    host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;max-width:calc(100vw - 32px)';
    this.host = host;
    this.root = host.attachShadow({ mode: 'closed' });
    this.metadata = metadata;
    this.handlers = handlers;
    this.doc.body.appendChild(host);
    this.render(metadata, handlers);
    this.doc.addEventListener('keydown', this.onKeydown, true);
    this.expiryTimer = setTimeout(() => this.dismiss(), CREDENTIAL_CAPTURE_TTL_MS);
  }

  isVisible(): boolean { return this.host !== null; }

  hide(): void {
    this.doc.removeEventListener('keydown', this.onKeydown, true);
    if (this.expiryTimer) { clearTimeout(this.expiryTimer); this.expiryTimer = null; }
    this.host?.remove();
    this.host = null;
    this.root = null;
    this.metadata = null;
    this.handlers = null;
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || !this.trustedAction(event) || !this.metadata) return;
    event.preventDefault();
    this.dismiss();
  };

  private dismiss(): void {
    const metadata = this.metadata;
    const handlers = this.handlers;
    if (!metadata || !handlers) return;
    this.hide();
    void handlers.dismiss(metadata.captureId);
  }

  private render(metadata: CredentialPromptMetadata, handlers: CredentialPromptHandlers): void {
    if (!this.root) return;
    const palette = shadowPalette(this.dark);
    this.root.replaceChildren();

    const style = this.doc.createElement('style');
    style.textContent = `
      *{box-sizing:border-box}
      .panel{width:320px;max-width:calc(100vw - 32px);padding:14px;background:${palette.bg};color:${palette.text};
        border:1px solid ${palette.border};border-radius:10px;box-shadow:${palette.shadow};font:13px/1.45 system-ui,-apple-system,sans-serif}
      h2{font-size:15px;line-height:1.3;margin:0 0 6px}.site,.destination{overflow-wrap:anywhere}.site{color:${palette.muted};margin:0 0 10px}
      .destination{margin:0 0 10px}.username{color:${palette.muted}}
      label{display:block;font-weight:600;margin:0 0 5px}select{width:100%;padding:7px 9px;margin:0 0 10px;border:1px solid ${palette.border};
        border-radius:7px;background:${palette.bg};color:${palette.text};font:inherit;outline:none}select:focus{box-shadow:0 0 0 3px ${palette.ring}}
      .actions{display:flex;gap:8px;justify-content:flex-end}.actions button{border:0;border-radius:7px;padding:7px 11px;font:600 13px system-ui;cursor:pointer}
      .primary{background:${palette.primary};color:${palette.primaryOn}}.secondary{background:${palette.hover};color:${palette.text}}
      button:disabled{opacity:.55;cursor:not-allowed}.status{min-height:19px;margin:8px 0 0;color:${palette.muted}}.status.error{color:${palette.dangerText}}
    `;
    const panel = this.doc.createElement('section');
    panel.className = 'panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'false');
    const title = this.doc.createElement('h2');
    title.id = `quickkee-credential-title-${metadata.captureId}`;
    title.textContent = metadata.retry ? 'Try saving again?'
      : metadata.suggestedAction === 'update' ? 'Update this password?'
        : metadata.suggestedAction === 'choose' ? 'Choose where to save this login'
          : 'Save this login?';
    panel.setAttribute('aria-labelledby', title.id);
    panel.appendChild(title);

    const site = this.doc.createElement('p');
    site.className = 'site';
    site.textContent = metadata.username ? `${metadata.site} · ${metadata.username}` : metadata.site;
    panel.appendChild(site);

    let selection = '';
    let select: HTMLSelectElement | null = null;
    if (metadata.suggestedAction === 'update' && metadata.entries[0]) {
      const destination = this.doc.createElement('p');
      destination.className = 'destination';
      destination.append('Update ');
      const name = this.doc.createElement('strong'); name.textContent = metadata.entries[0].title;
      destination.appendChild(name);
      if (metadata.entries[0].username) {
        const username = this.doc.createElement('span'); username.className = 'username';
        username.textContent = ` (${metadata.entries[0].username})`; destination.appendChild(username);
      }
      panel.appendChild(destination);
    } else if (metadata.suggestedAction === 'choose') {
      const label = this.doc.createElement('label'); label.textContent = 'Destination';
      select = this.doc.createElement('select'); select.setAttribute('aria-label', 'Credential destination');
      const placeholder = this.doc.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Choose an entry'; placeholder.disabled = true; placeholder.selected = true;
      select.appendChild(placeholder);
      for (const entry of metadata.entries) {
        const option = this.doc.createElement('option'); option.value = entry.id;
        option.textContent = entry.username ? `${entry.title} — ${entry.username}` : entry.title;
        select.appendChild(option);
      }
      const create = this.doc.createElement('option'); create.value = '__new__'; create.textContent = 'Save as new entry'; select.appendChild(create);
      panel.append(label, select);
    }

    const actions = this.doc.createElement('div'); actions.className = 'actions';
    const dismiss = this.doc.createElement('button'); dismiss.type = 'button'; dismiss.className = 'secondary'; dismiss.dataset.action = 'dismiss'; dismiss.textContent = 'Not now';
    const primary = this.doc.createElement('button'); primary.type = 'button'; primary.className = 'primary'; primary.dataset.action = 'primary';
    primary.textContent = metadata.retry ? 'Retry' : metadata.suggestedAction === 'update' ? 'Update' : 'Save';
    primary.disabled = metadata.suggestedAction === 'choose';
    actions.append(dismiss, primary); panel.appendChild(actions);
    const status = this.doc.createElement('p'); status.className = 'status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); panel.appendChild(status);

    select?.addEventListener('change', () => { selection = select?.value ?? ''; primary.disabled = !selection; status.textContent = ''; status.className = 'status'; });
    dismiss.addEventListener('click', event => { if (this.trustedAction(event)) this.dismiss(); });
    primary.addEventListener('click', event => {
      if (!this.trustedAction(event) || primary.disabled) return;
      primary.disabled = true; dismiss.disabled = true; status.textContent = 'Saving…'; status.className = 'status';
      const request: CredentialPromptCommit = { captureId: metadata.captureId };
      if (metadata.suggestedAction === 'save') request.saveAsNew = true;
      else if (metadata.suggestedAction === 'update' && metadata.entries[0]) request.entryId = metadata.entries[0].id;
      else if (selection === '__new__') request.saveAsNew = true;
      else if (selection) request.entryId = selection;
      void handlers.commit(request).then(ok => {
        if (this.metadata?.captureId !== metadata.captureId) return;
        if (ok) { this.hide(); return; }
        primary.disabled = metadata.suggestedAction === 'choose' && !selection;
        dismiss.disabled = false; status.textContent = 'Couldn’t save. Try again.'; status.className = 'status error';
      }).catch(() => {
        if (this.metadata?.captureId !== metadata.captureId) return;
        primary.disabled = metadata.suggestedAction === 'choose' && !selection;
        dismiss.disabled = false; status.textContent = 'Couldn’t save. Try again.'; status.className = 'status error';
      });
    });

    this.root.append(style, panel);
    queueMicrotask(() => { if (this.metadata?.captureId === metadata.captureId) primary.focus(); });
  }
}
