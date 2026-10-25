import { useState } from 'react';
import type { Instance } from '@/lib/types';
import type { InstanceAction } from '@/lib/api';
import { Badge } from '../ui/Badge';
import { Switch } from '../ui/Switch';
import { Tabs, TabPanel } from '../ui/Tabs';

/**
 * Right-hand control panel (the "JPanel" from the spec).
 *
 * HONESTY RULE: this project has no bot agent and no WhatsApp gateway. Those
 * two tabs are therefore rendered as clearly-marked, inert previews — the
 * switches move, but a banner states that nothing reaches the instance, and the
 * QR panel says no gateway exists instead of showing a fake QR. Only the Power
 * tab is wired to real endpoints. Inventing a working-looking bot panel would be
 * the easiest way to make this dashboard lie to its user.
 */
export interface JPanelSidebarProps {
  instance: Instance;
  busyAction: InstanceAction | null;
  onAction: (action: InstanceAction) => void;
}

type TabId = 'bot' | 'whatsapp' | 'power';

const TABS = [
  { id: 'bot', label: 'Bot' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'power', label: 'Power' },
] as const;

const WA_COMMANDS = [
  { cmd: '!ss', desc: 'Screenshot the running desktop' },
  { cmd: '!status', desc: 'Uptime, CPU and RAM' },
  { cmd: '!restart', desc: 'Restart the instance' },
];

function PreviewNote({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3 rounded-lg border border-status-warn/25 bg-status-warn/8 px-2.5 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-status-warn">Preview only</p>
      <p className="mt-0.5 text-[11px] leading-snug text-slate-400">{children}</p>
    </div>
  );
}

export function JPanelSidebar({ instance, busyAction, onAction }: JPanelSidebarProps): JSX.Element {
  const [tab, setTab] = useState<TabId>('power');

  // Local-only state for the preview tab. Never sent anywhere.
  const [autoAttack, setAutoAttack] = useState(false);
  const [autoMove, setAutoMove] = useState(false);
  const [autoRespawn, setAutoRespawn] = useState(false);
  const [skill, setSkill] = useState('1');

  const running = instance.status === 'running';
  const busy = busyAction !== null;

  return (
    <aside className="cyber-panel flex min-h-0 flex-col overflow-hidden">
      <Tabs tabs={TABS} active={tab} onChange={(id) => setTab(id as TabId)} />

      <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {/* ------------------------------------------------------- bot tab --- */}
        <TabPanel id="bot" active={tab}>
          <PreviewNote>
            No bot agent is attached to this instance. These controls do not reach the desktop.
          </PreviewNote>

          <div className="divide-y divide-white/5">
            <Switch
              label="Auto attack"
              description="Repeat the primary attack key on a fixed interval."
              checked={autoAttack}
              onChange={setAutoAttack}
            />
            <Switch
              label="Auto move / route"
              description="Follow a recorded waypoint loop."
              checked={autoMove}
              onChange={setAutoMove}
            />
            <Switch
              label="Auto respawn"
              description="Return to the last safe point after death."
              checked={autoRespawn}
              onChange={setAutoRespawn}
            />
          </div>

          <div className="mt-3">
            <label htmlFor="skill-slot" className="label">
              Skill slot
            </label>
            <select
              id="skill-slot"
              value={skill}
              onChange={(event) => setSkill(event.target.value)}
              className="field py-2 text-[12px]"
            >
              <option value="1">Slot 1 — primary attack</option>
              <option value="2">Slot 2 — area attack</option>
              <option value="3">Slot 3 — buff</option>
              <option value="4">Slot 4 — heal</option>
            </select>
            <p className="hint">Bind a slot to hotkeys 1-4 on the mobile bar.</p>
          </div>
        </TabPanel>

        {/* -------------------------------------------------- whatsapp tab --- */}
        <TabPanel id="whatsapp" active={tab}>
          <PreviewNote>
            No WhatsApp gateway is deployed. Linking a number is not possible yet.
          </PreviewNote>

          <div className="rounded-lg border border-dashed border-white/15 bg-black/30 p-4">
            <div className="mx-auto grid h-32 w-32 place-items-center rounded-md border border-white/10 bg-cyber-raised">
              <span className="px-3 text-center text-[10px] leading-snug text-slate-500">
                QR appears here once a gateway is configured
              </span>
            </div>
            <p className="mt-3 text-center text-[11px] text-slate-500">
              Link a number to drive this instance from chat.
            </p>
            <button
              type="button"
              disabled
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-slate-500 disabled:cursor-not-allowed"
            >
              Generate QR — unavailable
            </button>
          </div>

          <div className="mt-4">
            <p className="label">Commands</p>
            <ul className="space-y-1.5">
              {WA_COMMANDS.map((entry) => (
                <li key={entry.cmd} className="flex items-start gap-2">
                  <code className="shrink-0 rounded border border-white/10 bg-black/40 px-1.5 py-0.5 text-[10px] text-neon">
                    {entry.cmd}
                  </code>
                  <span className="text-[11px] leading-snug text-slate-500">{entry.desc}</span>
                </li>
              ))}
            </ul>
          </div>
        </TabPanel>

        {/* ----------------------------------------------------- power tab --- */}
        <TabPanel id="power" active={tab}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Current state</span>
            <Badge tone={running ? 'online' : instance.status === 'failed' ? 'offline' : 'neutral'}>{instance.status}</Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onAction('start')}
              disabled={busy || running}
              className="rounded-lg border border-neon/40 bg-neon/15 px-3 py-2 text-[12px] font-semibold text-neon transition-colors hover:bg-neon/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'start' ? 'Starting…' : 'Start'}
            </button>
            <button
              type="button"
              onClick={() => onAction('stop')}
              disabled={busy || !running}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'stop' ? 'Stopping…' : 'Stop'}
            </button>
            <button
              type="button"
              onClick={() => onAction('restart')}
              disabled={busy}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-[12px] font-semibold text-slate-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'restart' ? 'Restarting…' : 'Restart'}
            </button>
            <button
              type="button"
              onClick={() => onAction('reset')}
              disabled={busy}
              title="Destroys the container and provisions a fresh one with a new VNC password"
              className="rounded-lg border border-status-bad/40 bg-status-bad/15 px-3 py-2 text-[12px] font-semibold text-status-bad transition-colors hover:bg-status-bad/25 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busyAction === 'reset' ? 'Rebuilding…' : 'Rebuild'}
            </button>
          </div>

          <p className="mt-3 text-[10px] leading-relaxed text-slate-500">
            Rebuild re-provisions this instance and issues a new VNC password. Anything stored inside
            the container is lost.
          </p>

          <div className="mt-4 space-y-1.5 border-t border-cyber-line pt-3 font-mono text-[10px] text-slate-500">
            <div className="flex justify-between gap-2">
              <span>ws port</span>
              <span className="text-slate-300">{instance.wsPort}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span>proxy</span>
              {/* min-w-0 is required: a flex child refuses to shrink below its
                  content width, so `truncate` alone leaves the long proxy path
                  pushing past the panel edge instead of ellipsising. */}
              <span className="min-w-0 truncate text-right text-slate-300" title={instance.proxyPath}>
                {instance.proxyPath}
              </span>
            </div>
            <div className="flex justify-between gap-2">
              <span>jdk</span>
              <span className="text-slate-300">{instance.javaVersion}</span>
            </div>
          </div>
        </TabPanel>
      </div>
    </aside>
  );
}
