import { useRef, useState } from 'react';
import type { CameraInputHandle } from '../controls/useCameraControls';

interface JoystickProps {
  label: string;
  caption: string;
  onChange: (x: number, y: number) => void;
}

function Joystick({ label, caption, onChange }: JoystickProps) {
  const pad = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const pointer = useRef<number | null>(null);

  const update = (clientX: number, clientY: number) => {
    const element = pad.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const travel = rect.width * 0.32;
    let dx = clientX - (rect.left + rect.width / 2);
    let dy = clientY - (rect.top + rect.height / 2);
    const length = Math.hypot(dx, dy);
    if (length > travel) {
      dx = (dx / length) * travel;
      dy = (dy / length) * travel;
    }
    setKnob({ x: dx, y: dy });
    onChange(dx / travel, dy / travel);
  };

  const release = () => {
    pointer.current = null;
    setKnob({ x: 0, y: 0 });
    onChange(0, 0);
  };

  return (
    <div className="joystick">
      <div
        ref={pad}
        className="joystick-pad"
        role="application"
        aria-label={label}
        onPointerDown={(event) => {
          if (pointer.current !== null) return;
          pointer.current = event.pointerId;
          event.currentTarget.setPointerCapture(event.pointerId);
          update(event.clientX, event.clientY);
        }}
        onPointerMove={(event) => {
          if (pointer.current !== event.pointerId) return;
          update(event.clientX, event.clientY);
        }}
        onPointerUp={(event) => {
          if (pointer.current !== event.pointerId) return;
          release();
        }}
        onPointerCancel={() => {
          if (pointer.current !== null) release();
        }}
        onLostPointerCapture={() => {
          if (pointer.current !== null) release();
        }}
      >
        <span className="joystick-axis" />
        <span
          className="joystick-knob"
          style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }}
        />
      </div>
      <span className="joystick-caption">{caption}</span>
    </div>
  );
}

export function Joysticks({ controls }: { controls: CameraInputHandle }) {
  return (
    <div className="joystick-layer" data-testid="joysticks">
      <div className="joystick-side">
        <Joystick label="移动摇杆" caption="移动" onChange={controls.setMove} />
        <div className="rise-buttons">
          <button
            className="rise-button"
            aria-label="相机上升"
            onPointerDown={() => controls.setRise(1)}
            onPointerUp={() => controls.setRise(0)}
            onPointerLeave={() => controls.setRise(0)}
            onPointerCancel={() => controls.setRise(0)}
          >
            +
          </button>
          <button
            className="rise-button"
            aria-label="相机下降"
            onPointerDown={() => controls.setRise(-1)}
            onPointerUp={() => controls.setRise(0)}
            onPointerLeave={() => controls.setRise(0)}
            onPointerCancel={() => controls.setRise(0)}
          >
            −
          </button>
        </div>
      </div>
      <Joystick label="视角摇杆" caption="视角" onChange={controls.setLook} />
    </div>
  );
}
