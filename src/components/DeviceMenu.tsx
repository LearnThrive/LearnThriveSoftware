import { useRef, type RefObject } from 'react';
import type { DeviceOption } from '../media';
import { usePopoverDismiss } from '../usePopoverDismiss';
import { Icon } from './Icon';

interface DeviceMenuProps {
  open: boolean;
  onClose: () => void;
  cameras: DeviceOption[];
  microphones: DeviceOption[];
  selectedCamera: string | undefined;
  selectedMicrophone: string | undefined;
  onSelectCamera: (deviceId: string) => void;
  onSelectMicrophone: (deviceId: string) => void;
  canFlip: boolean;
  onFlip: () => void;
  triggerRef: RefObject<HTMLButtonElement | null>;
  layoutMode?: 'focus' | 'sideBySide';
  onLayoutMode?: (mode: 'focus' | 'sideBySide') => void;
}

export function DeviceMenu({
  open, onClose, cameras, microphones, selectedCamera, selectedMicrophone, onSelectCamera, onSelectMicrophone, canFlip, onFlip,
  triggerRef, layoutMode, onLayoutMode,
}: DeviceMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, onClose, menuRef, triggerRef);

  if (!open) return null;

  return (
    <div className="device-menu" ref={menuRef} role="menu" aria-label="Meeting settings">
      <div className="device-menu-group">
        <label htmlFor="camera-select">Camera</label>
        <select id="camera-select" value={selectedCamera ?? ''} onChange={(event) => onSelectCamera(event.target.value)}>
          <option value="" disabled hidden>{cameras.length === 0 ? 'No cameras found' : 'Default'}</option>
          {cameras.map((camera) => <option key={camera.deviceId} value={camera.deviceId}>{camera.label}</option>)}
        </select>
      </div>
      <div className="device-menu-group">
        <label htmlFor="microphone-select">Microphone</label>
        <select id="microphone-select" value={selectedMicrophone ?? ''} onChange={(event) => onSelectMicrophone(event.target.value)}>
          <option value="" disabled hidden>{microphones.length === 0 ? 'No microphones found' : 'Default'}</option>
          {microphones.map((mic) => <option key={mic.deviceId} value={mic.deviceId}>{mic.label}</option>)}
        </select>
      </div>
      {canFlip && <button type="button" className="device-menu-flip" onClick={onFlip}><Icon name="flip" size={16} />Switch front/rear camera</button>}
      {layoutMode && onLayoutMode && <div className="device-menu-group">
        <label id="layout-label">Layout</label>
        <div className="device-menu-layout" role="group" aria-labelledby="layout-label">
          <button type="button" className={layoutMode === 'focus' ? 'is-active' : ''} aria-pressed={layoutMode === 'focus'} onClick={() => onLayoutMode('focus')}>Focus</button>
          <button type="button" className={layoutMode === 'sideBySide' ? 'is-active' : ''} aria-pressed={layoutMode === 'sideBySide'} onClick={() => onLayoutMode('sideBySide')}>Side by side</button>
        </div>
      </div>}
    </div>
  );
}
