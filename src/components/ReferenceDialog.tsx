import { useEffect, useRef } from 'react';
import { SCENE_REFERENCES } from '../scenes/references';
import { getScene } from '../scenes/registry';
import { Icon } from './Icon';

export function ReferenceDialog({ open, sceneId, onClose }: { open: boolean; sceneId: string; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const scene = getScene(sceneId);
  const reference = SCENE_REFERENCES[scene.id];
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open) dialog.current?.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="reference-dialog" aria-labelledby="reference-title" onCancel={onClose}
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <button className="dialog-close" aria-label="关闭参考图" onClick={onClose}><Icon name="close" /></button>
      <span className="eyebrow">SCENE REFERENCE</span>
      <h2 id="reference-title">{scene.name}</h2>
      <p>{reference.description}</p>
      {open && <img src={reference.image} alt={`${scene.name}的建模参考图`} />}
    </dialog>
  );
}
