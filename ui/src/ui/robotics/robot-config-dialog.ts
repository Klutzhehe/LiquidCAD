import type { SerializedAssembly } from '../../types';
import type { Viewer } from '../../viewer';
import { exportRobotDefinition } from '../../api';
import { ICON_CLOSE } from '../icons';
import { compileRobotAssembly, inferDefaultConfig, type CompilerAssemblySource } from '../../robotics/robot-compiler';
import type { InstanceRoboticsConfig, RobotRole } from '../../robotics/types';

export class RobotConfigDialog {
  private overlay: HTMLDivElement;
  private viewer: Viewer;
  private currentAssembly: SerializedAssembly | null = null;
  private activeTab: 'components' | 'transforms' | 'json' | 'urdf' = 'components';
  private configs = new Map<string, InstanceRoboticsConfig>();
  private statusEl!: HTMLDivElement;
  private syncBtn!: HTMLButtonElement;
  private currentFilePath = '';

  constructor(container: HTMLElement, viewer: Viewer) {
    this.viewer = viewer;

    this.overlay = document.createElement('div');
    this.overlay.className = 'fixed inset-0 z-[320] bg-black/60 backdrop-blur-sm flex items-center justify-center hidden select-none';
    this.overlay.innerHTML = this.buildHTML();
    container.appendChild(this.overlay);

    this.bindEvents();
  }

  show(assembly: SerializedAssembly, currentFilePath = ''): void {
    this.currentAssembly = assembly;
    this.currentFilePath = currentFilePath;

    // Seed default configs for instances if not already present
    const instances = assembly.instances || [];
    const mates = assembly.mates || [];

    for (const inst of instances) {
      if (!this.configs.has(inst.instanceId)) {
        const isGrounded = inst.instanceId === assembly.groundedInstanceId || inst.grounded;
        const inferred = inferDefaultConfig(inst, isGrounded, instances, mates);
        this.configs.set(inst.instanceId, inferred);
      }
    }

    this.render();
    this.overlay.classList.remove('hidden');
  }

  hide(): void {
    this.overlay.classList.add('hidden');
  }

  private buildHTML(): string {
    return `
      <div class="w-[860px] max-w-[95vw] h-[640px] max-h-[92vh] bg-base-100 border border-base-content/15 rounded-xl shadow-2xl flex flex-col overflow-hidden text-base-content">
        <!-- Dialog Header -->
        <div class="px-5 py-4 border-b border-base-content/10 flex items-center justify-between bg-base-200/50">
          <div class="flex items-center gap-3">
            <img src="/icons/robot.png" class="size-6 object-contain" alt="Robot" />
            <div>
              <h2 class="text-sm font-semibold tracking-wide flex items-center gap-2">
                Robot Configuration & ROS Kinematics
                <span class="badge badge-xs badge-info font-mono">SI (meters / rad)</span>
              </h2>
              <p class="text-xs text-base-content/60">Configure servos, actuators, and sensor frames for ESP Flow & ROS</p>
            </div>
          </div>
          <button data-ref="close-btn" class="btn btn-ghost btn-square btn-sm text-base-content/60 hover:text-base-content">
            ${ICON_CLOSE}
          </button>
        </div>

        <!-- Tab Selector -->
        <div class="px-5 pt-2 border-b border-base-content/10 flex gap-2 bg-base-100 text-xs font-medium">
          <button data-tab="components" class="px-3 py-2 border-b-2 border-primary text-primary transition-colors">Components & Joints</button>
          <button data-tab="transforms" class="px-3 py-2 border-b-2 border-transparent text-base-content/60 hover:text-base-content transition-colors">3D Transforms (TF)</button>
          <button data-tab="json" class="px-3 py-2 border-b-2 border-transparent text-base-content/60 hover:text-base-content transition-colors">Robot Definition JSON</button>
          <button data-tab="urdf" class="px-3 py-2 border-b-2 border-transparent text-base-content/60 hover:text-base-content transition-colors">ROS URDF XML</button>
        </div>

        <!-- Content Area -->
        <div data-ref="content" class="flex-1 overflow-y-auto p-5 font-sans min-h-0 bg-base-100/50"></div>

        <!-- Footer Actions -->
        <div class="px-5 py-3 border-t border-base-content/10 flex items-center justify-between bg-base-200/40">
          <div data-ref="status" class="text-xs flex items-center gap-2 text-base-content/70"></div>
          <div class="flex items-center gap-2">
            <button data-ref="download-json-btn" class="btn btn-sm btn-ghost text-xs">Download JSON</button>
            <button data-ref="download-urdf-btn" class="btn btn-sm btn-ghost text-xs">Download URDF</button>
            <button data-ref="sync-flow-btn" class="btn btn-sm btn-primary text-xs gap-1.5 shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4 20-7z"/></svg>
              Sync with ESP Flow
            </button>
          </div>
        </div>
      </div>
    `;
  }

  private bindEvents(): void {
    this.overlay.querySelector('[data-ref="close-btn"]')?.addEventListener('click', () => this.hide());
    this.statusEl = this.overlay.querySelector('[data-ref="status"]')!;
    this.syncBtn = this.overlay.querySelector('[data-ref="sync-flow-btn"]')!;

    // Tabs
    const tabs = this.overlay.querySelectorAll<HTMLButtonElement>('[data-tab]');
    tabs.forEach((tab) => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.tab as typeof this.activeTab;
        if (!target) return;
        this.activeTab = target;
        tabs.forEach((t) => {
          const isActive = t === tab;
          t.classList.toggle('border-primary', isActive);
          t.classList.toggle('text-primary', isActive);
          t.classList.toggle('border-transparent', !isActive);
          t.classList.toggle('text-base-content/60', !isActive);
        });
        this.render();
      });
    });

    // Actions
    this.syncBtn.addEventListener('click', () => void this.handleSyncWithFlow());
    this.overlay.querySelector('[data-ref="download-json-btn"]')?.addEventListener('click', () => this.handleDownloadJson());
    this.overlay.querySelector('[data-ref="download-urdf-btn"]')?.addEventListener('click', () => this.handleDownloadUrdf());
  }

  private getCompilerSource(): CompilerAssemblySource | null {
    if (!this.currentAssembly) return null;
    const controller = this.viewer.getAssemblyController();
    if (!controller) return null;

    return {
      assembly: this.currentAssembly,
      getInstancePose: (id) => controller.getInstancePose(id),
      getInstanceGroup: (id) => controller.getInstanceGroup(id),
    };
  }

  private render(): void {
    const content = this.overlay.querySelector<HTMLDivElement>('[data-ref="content"]');
    if (!content || !this.currentAssembly) return;

    const source = this.getCompilerSource();
    if (!source) {
      content.innerHTML = `<div class="p-8 text-center text-sm text-base-content/50">Assembly controller is not active. Load an assembly file first.</div>`;
      return;
    }

    const { robotDefinition, urdf, transforms } = compileRobotAssembly(
      source,
      this.configs,
      'Flow Robot',
    );

    if (this.activeTab === 'components') {
      content.innerHTML = this.renderComponentsTab(transforms);
      this.bindComponentFormEvents(content);
    } else if (this.activeTab === 'transforms') {
      content.innerHTML = this.renderTransformsTab(transforms);
    } else if (this.activeTab === 'json') {
      content.innerHTML = `
        <div class="flex flex-col h-full gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-base-content/60">Standard ESP Flow RobotDefinition (v${robotDefinition.schemaVersion})</span>
            <button data-ref="copy-json" class="btn btn-xs btn-ghost gap-1 font-mono">Copy JSON</button>
          </div>
          <pre class="flex-1 overflow-auto bg-base-300/40 p-4 rounded-lg font-mono text-xs leading-relaxed border border-base-content/10 select-text">${escapeHtml(JSON.stringify(robotDefinition, null, 2))}</pre>
        </div>
      `;
      content.querySelector('[data-ref="copy-json"]')?.addEventListener('click', (e) => {
        void navigator.clipboard.writeText(JSON.stringify(robotDefinition, null, 2));
        const btn = e.currentTarget as HTMLButtonElement;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy JSON'; }, 1500);
      });
    } else if (this.activeTab === 'urdf') {
      content.innerHTML = `
        <div class="flex flex-col h-full gap-2">
          <div class="flex items-center justify-between">
            <span class="text-xs text-base-content/60">Universal Robot Description Format (URDF) for ROS2 / RViz</span>
            <button data-ref="copy-urdf" class="btn btn-xs btn-ghost gap-1 font-mono">Copy URDF</button>
          </div>
          <pre class="flex-1 overflow-auto bg-base-300/40 p-4 rounded-lg font-mono text-xs leading-relaxed border border-base-content/10 select-text">${escapeHtml(urdf)}</pre>
        </div>
      `;
      content.querySelector('[data-ref="copy-urdf"]')?.addEventListener('click', (e) => {
        void navigator.clipboard.writeText(urdf);
        const btn = e.currentTarget as HTMLButtonElement;
        btn.textContent = 'Copied!';
        setTimeout(() => { btn.textContent = 'Copy URDF'; }, 1500);
      });
    }
  }

  private renderComponentsTab(transforms: Map<string, any>): string {
    const instances = this.currentAssembly?.instances || [];
    const ROLES: { value: RobotRole; label: string }[] = [
      { value: 'chassis', label: 'Chassis (base_link)' },
      { value: 'wheel', label: 'Wheel (Motor)' },
      { value: 'servo', label: 'Actuator / Servo' },
      { value: 'linear_actuator', label: 'Linear Actuator' },
      { value: 'lidar', label: 'LiDAR Sensor' },
      { value: 'imu', label: 'IMU (Gyro/Accel)' },
      { value: 'camera', label: 'Camera Sensor' },
      { value: 'ultrasonic', label: 'Range / Sonar' },
      { value: 'structural', label: 'Passive Link' },
    ];

    return `
      <div class="flex flex-col gap-3">
        <div class="text-xs text-base-content/60">
          Assign physical robotic roles and hardware interfaces to each assembly instance:
        </div>
        <div class="overflow-x-auto border border-base-content/10 rounded-lg">
          <table class="table table-xs w-full">
            <thead class="bg-base-200/50">
              <tr>
                <th class="py-2">Instance</th>
                <th class="py-2">Role</th>
                <th class="py-2">Frame / Link</th>
                <th class="py-2">Pin / Channel</th>
                <th class="py-2">Limits</th>
                <th class="py-2">Offset (X, Y, Z mm)</th>
              </tr>
            </thead>
            <tbody>
              ${instances.map((inst) => {
                const conf = this.configs.get(inst.instanceId)!;
                const tf = transforms.get(inst.instanceId);
                const offX = tf ? Math.round(tf.translationM.x * 1000) : 0;
                const offY = tf ? Math.round(tf.translationM.y * 1000) : 0;
                const offZ = tf ? Math.round(tf.translationM.z * 1000) : 0;

                const hasLimits = conf.role === 'servo' || conf.role === 'linear_actuator';
                const limitsVal = conf.limitsDeg ? `${conf.limitsDeg[0]}, ${conf.limitsDeg[1]}` : (conf.role === 'servo' ? '-90, 90' : '0, 50');

                return `
                  <tr class="hover:bg-base-200/30 transition-colors" data-inst-id="${inst.instanceId}">
                    <td class="font-medium text-xs py-2 flex items-center gap-1.5">
                      ${inst.grounded ? '<span class="badge badge-xs badge-success">ground</span>' : ''}
                      <span>${escapeHtml(inst.name || inst.partName)}</span>
                    </td>
                    <td>
                      <select data-field="role" class="select select-bordered select-xs text-xs py-0">
                        ${ROLES.map((r) => `<option value="${r.value}" ${conf.role === r.value ? 'selected' : ''}>${r.label}</option>`).join('')}
                      </select>
                    </td>
                    <td>
                      <input data-field="frameId" type="text" value="${escapeHtml(conf.frameId)}" class="input input-bordered input-xs w-28 font-mono text-xs" />
                    </td>
                    <td>
                      <input data-field="channelPin" type="text" value="${escapeHtml(conf.channelPin || '')}" placeholder="e.g. GPIO18" class="input input-bordered input-xs w-24 font-mono text-xs" />
                    </td>
                    <td>
                      <input data-field="limits" type="text" value="${hasLimits ? limitsVal : ''}" placeholder="${hasLimits ? '-90, 90' : 'none'}" ${hasLimits ? '' : 'disabled'} class="input input-bordered input-xs w-20 font-mono text-xs ${hasLimits ? '' : 'opacity-40'}" />
                    </td>
                    <td class="font-mono text-xs text-base-content/70">
                      [${offX}, ${offY}, ${offZ}]
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private renderTransformsTab(transforms: Map<string, any>): string {
    const instances = this.currentAssembly?.instances || [];

    return `
      <div class="flex flex-col gap-3">
        <div class="text-xs text-base-content/60">
          Evaluated 3D Transform Tree relative to <code class="text-primary font-mono font-bold">base_link</code>:
        </div>
        <div class="overflow-x-auto border border-base-content/10 rounded-lg">
          <table class="table table-xs w-full">
            <thead class="bg-base-200/50 font-mono">
              <tr>
                <th class="py-2">Child Frame</th>
                <th class="py-2">Parent Frame</th>
                <th class="py-2">Translation (m)</th>
                <th class="py-2">Rotation (Roll, Pitch, Yaw)</th>
              </tr>
            </thead>
            <tbody class="font-mono text-xs">
              ${instances.map((inst) => {
                const conf = this.configs.get(inst.instanceId);
                const tf = transforms.get(inst.instanceId);
                if (!tf) return '';
                const frame = conf?.frameId || `${inst.name}_link`;
                const parent = tf.parentFrameId || 'base_link';

                const tx = tf.translationM.x.toFixed(3);
                const ty = tf.translationM.y.toFixed(3);
                const tz = tf.translationM.z.toFixed(3);

                const rx = ((tf.rotationRad.x * 180) / Math.PI).toFixed(1);
                const ry = ((tf.rotationRad.y * 180) / Math.PI).toFixed(1);
                const rz = ((tf.rotationRad.z * 180) / Math.PI).toFixed(1);

                return `
                  <tr class="hover:bg-base-200/30">
                    <td class="font-bold text-primary">${frame}</td>
                    <td>${parent}</td>
                    <td>[${tx}, ${ty}, ${tz}] m</td>
                    <td>[${rx}°, ${ry}°, ${rz}°]</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  private bindComponentFormEvents(container: HTMLElement): void {
    const rows = container.querySelectorAll<HTMLTableRowElement>('tr[data-inst-id]');
    rows.forEach((row) => {
      const instId = row.dataset.instId!;
      const conf = this.configs.get(instId);
      if (!conf) return;

      const roleSelect = row.querySelector<HTMLSelectElement>('[data-field="role"]');
      const frameInput = row.querySelector<HTMLInputElement>('[data-field="frameId"]');
      const pinInput = row.querySelector<HTMLInputElement>('[data-field="channelPin"]');
      const limitsInput = row.querySelector<HTMLInputElement>('[data-field="limits"]');

      roleSelect?.addEventListener('change', () => {
        conf.role = roleSelect.value as RobotRole;
        if (conf.role === 'chassis') {
          conf.frameId = 'base_link';
        }
        this.render();
      });

      frameInput?.addEventListener('change', () => {
        conf.frameId = frameInput.value.trim();
      });

      pinInput?.addEventListener('change', () => {
        conf.channelPin = pinInput.value.trim();
      });

      limitsInput?.addEventListener('change', () => {
        const parts = limitsInput.value.split(',').map((p) => Number(p.trim())).filter((n) => Number.isFinite(n));
        if (parts.length >= 2) {
          conf.limitsDeg = [parts[0], parts[1]];
        }
      });
    });
  }

  private async handleSyncWithFlow(): Promise<void> {
    const source = this.getCompilerSource();
    if (!source) return;

    this.statusEl.textContent = 'Syncing robot definition with project...';
    this.syncBtn.disabled = true;

    try {
      const { robotDefinition, urdf } = compileRobotAssembly(source, this.configs, 'Flow Robot');

      const res = await exportRobotDefinition({
        robotDefinition,
        urdf,
        activeFile: this.currentFilePath,
      });

      if (res.success) {
        this.statusEl.innerHTML = `<span class="text-success font-medium">✓ Synced to project robot-definition.json</span>`;
      } else {
        this.statusEl.innerHTML = `<span class="text-error">${res.error || 'Failed to sync'}</span>`;
      }
    } catch (err: any) {
      this.statusEl.innerHTML = `<span class="text-error">${err.message || 'Sync error'}</span>`;
    } finally {
      this.syncBtn.disabled = false;
    }
  }

  private handleDownloadJson(): void {
    const source = this.getCompilerSource();
    if (!source) return;
    const { robotDefinition } = compileRobotAssembly(source, this.configs, 'Flow Robot');
    const blob = new Blob([JSON.stringify(robotDefinition, null, 2)], { type: 'application/json' });
    downloadBlob(blob, 'robot-definition.json');
  }

  private handleDownloadUrdf(): void {
    const source = this.getCompilerSource();
    if (!source) return;
    const { urdf } = compileRobotAssembly(source, this.configs, 'Flow Robot');
    const blob = new Blob([urdf], { type: 'text/xml' });
    downloadBlob(blob, 'robot.urdf');
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
