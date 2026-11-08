import { useEffect, useRef, useState } from 'react';
import { useCameraControls } from '../controls/useCameraControls';
import { getLens, getSensor } from '../data/equipment';
import type { RendererStatus, SimulatorRenderer } from '../renderer/SimulatorRenderer';
import { getScene } from '../scenes/registry';
import { useSimulator } from '../state/simulator';
import { Icon } from './Icon';
import { Joysticks } from './Joysticks';

interface DragState {
  id: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  moved: boolean;
}

export function Viewfinder({ sceneId }: { sceneId: string }) {
  const {
    state: { parameters, view },
    dispatch,
  } = useSimulator();
  const sensor = getSensor(parameters.sensorId);
  const lens = getLens(parameters.lensId);
  const host = useRef<HTMLDivElement>(null);
  const engine = useRef<SimulatorRenderer | null>(null);
  const latest = useRef({ parameters, sensor, lens, view });
  latest.current = { parameters, sensor, lens, view };
  const [traceStatus, setTraceStatus] = useState('');
  const [status, setStatus] = useState<RendererStatus>('loading');
  const [focusPoint, setFocusPoint] = useState<{ x: number; y: number } | null>(null);
  const drag = useRef<DragState | null>(null);
  const controls = useCameraControls(parameters.pose, dispatch, getScene(sceneId).poseLimits);

  useEffect(() => {
    let cancelled = false;
    setStatus('loading');
    setTraceStatus('');
    import('../renderer/SimulatorRenderer')
      .then(({ SimulatorRenderer: Renderer }) => {
        if (cancelled || !host.current) return;
        try {
          const instance = new Renderer(host.current, getScene(sceneId), setStatus, setTraceStatus);
          engine.current = instance;
          const current = latest.current;
          instance.update(
            current.parameters,
            current.sensor,
            current.lens,
            current.view,
          );
        } catch (error) {
          console.error('Unable to start the 3D preview', error);
          setStatus('unavailable');
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.error(error);
          setStatus('unavailable');
        }
      });
    return () => {
      cancelled = true;
      engine.current?.dispose();
      engine.current = null;
    };
  }, [sceneId]);

  useEffect(() => {
    engine.current?.update(parameters, sensor, lens, view);
  }, [parameters, sensor, lens, view]);

  useEffect(() => {
    if (focusPoint) {
      const timer = setTimeout(() => setFocusPoint(null), 1400);
      return () => clearTimeout(timer);
    }
  }, [focusPoint]);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      controls.dolly(-event.deltaY * 0.0016);
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [controls]);

  const pose = parameters.pose;
  const poseLabel = `x ${pose.x.toFixed(2)} · y ${pose.y.toFixed(2)} · z ${pose.z.toFixed(2)} · ${Math.round(pose.yawDeg)}°`;

  const releaseFocus = (event: React.PointerEvent<HTMLDivElement>, state: DragState) => {
    if (state.moved || status !== 'ready') return;
    const hit = engine.current?.focusAt(event.clientX, event.clientY);
    if (!hit) return;
    dispatch({ type: 'focusAtPoint', point: hit.point });
    const rect = event.currentTarget.getBoundingClientRect();
    setFocusPoint({
      x: ((event.clientX - rect.left) / rect.width) * 100,
      y: ((event.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <div className="viewfinder-module">
      <div className="viewer-toolbar">
        <div className="live-label">
          <span className={status === 'ready' ? 'status-dot' : 'status-dot muted'} />
          <span>{view.renderMode === 'pathtraced' ? '光追取景' : '实时取景'}</span>
          <span className="toolbar-divider" />
          <span className="toolbar-caption">
            {sensor.shortName} · {(sensor.widthMm / sensor.heightMm).toFixed(2)}:1
          </span>
        </div>
        <div className="viewer-tools">
          <button className="tool-button" aria-label="对焦音效" aria-pressed={view.focusSound}
            title={view.focusSound ? '关闭对焦音效' : '开启对焦音效'}
            onClick={() => dispatch({ type: 'view', patch: { focusSound: !view.focusSound } })}>
            <Icon name={view.focusSound ? 'sound' : 'muted'} size={16} />
            <span>音效</span>
          </button>
          <button
            className="tool-button"
            aria-label="三分构图线"
            aria-pressed={view.grid}
            onClick={() => dispatch({ type: 'view', patch: { grid: !view.grid } })}
          >
            <Icon name="grid" size={16} />
            <span>构图线</span>
          </button>
          <button
            className="tool-button"
            aria-label="景深预览"
            aria-pressed={view.depthOfField}
            onClick={() => dispatch({ type: 'view', patch: { depthOfField: !view.depthOfField } })}
          >
            <Icon name="aperture" size={16} />
            <span>景深预览</span>
          </button>
          <button
            className="tool-button"
            aria-label="虚拟摇杆"
            aria-pressed={view.touchControls}
            onClick={() =>
              dispatch({ type: 'view', patch: { touchControls: !view.touchControls } })
            }
          >
            <Icon name="joystick" size={16} />
            <span>摇杆</span>
          </button>
          <button
            className="tool-button"
            aria-label="复位机位"
            onClick={() => dispatch({ type: 'resetCamera' })}
          >
            <Icon name="reset" size={16} />
            <span>复位</span>
          </button>
        </div>
      </div>
      <div className="viewer-stage">
        <div
          className="image-frame"
          data-testid="image-frame"
          style={{ aspectRatio: `${sensor.widthMm} / ${sensor.heightMm}` }}
        >
          <div
            className="canvas-host"
            ref={host}
            data-testid="canvas-host"
            data-status={status}
            onPointerDown={(event) => {
              if (event.button !== 0 || status !== 'ready') return;
              drag.current = {
                id: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                lastX: event.clientX,
                lastY: event.clientY,
                moved: false,
              };
              event.currentTarget.setPointerCapture(event.pointerId);
            }}
            onPointerMove={(event) => {
              const state = drag.current;
              if (!state || state.id !== event.pointerId) return;
              const dx = event.clientX - state.lastX;
              const dy = event.clientY - state.lastY;
              if (
                !state.moved &&
                Math.hypot(event.clientX - state.startX, event.clientY - state.startY) > 5
              )
                state.moved = true;
              if (!state.moved) return;
              controls.nudge(-dx * 0.14, -dy * 0.12);
              state.lastX = event.clientX;
              state.lastY = event.clientY;
            }}
            onPointerUp={(event) => {
              const state = drag.current;
              if (!state || state.id !== event.pointerId) return;
              drag.current = null;
              releaseFocus(event, state);
            }}
            onPointerCancel={() => {
              drag.current = null;
            }}
          />
          {status !== 'ready' && (
            <div className="viewer-fallback" role="status">
              <Icon name="camera" size={36} />
              <strong>
                {status === 'loading'
                  ? '正在布置场景…'
                  : status === 'lost'
                    ? '图形连接暂时中断'
                    : '当前环境无法开启三维预览'}
              </strong>
              <p>
                {status === 'loading'
                  ? '准备场景、材质与光线'
                  : status === 'lost'
                    ? '等待浏览器恢复 WebGL，光学计算仍可使用。'
                    : '请使用支持 WebGL 2 的浏览器。下方光学计算与参数调整仍然可用。'}
              </p>
            </div>
          )}
          {view.grid && (
            <div className="composition-grid" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
          )}
          <div className="frame-corners" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="frame-label">
            <span className="frame-dot" />
            {view.depthOfField ? 'DOF ON' : 'DOF OFF'}
            <span className="frame-mode">{parameters.constantExposure ? 'CE' : 'EV'}</span>
          </div>
          {traceStatus && <div className="trace-status" role="status">{traceStatus}</div>}
          <div className="center-focus" aria-hidden="true">
            +
          </div>
          {focusPoint && (
            <div
              className="focus-point"
              style={{ left: `${focusPoint.x}%`, top: `${focusPoint.y}%` }}
              aria-hidden="true"
            />
          )}
          {view.touchControls && <Joysticks controls={controls} />}
          <div className="viewfinder-readout">
            <span>
              {parameters.focalLengthMm.toFixed(Number.isInteger(parameters.focalLengthMm) ? 0 : 1)}
              <small>mm</small>
            </span>
            <span>f/{parameters.aperture.toFixed(1)}</span>
            <span>
              {parameters.focusDistanceM === Infinity ? '∞' : parameters.focusDistanceM.toFixed(2)}
              <small>m</small>
            </span>
            <span className="readout-manual">M</span>
          </div>
        </div>
      </div>
      <div className="viewer-bottom">
        <span>
          <Icon name="move" size={14} />
          {view.touchControls
            ? '左摇杆移动 · 右摇杆转向 · 点按对焦'
            : 'WASD 移动 · J/K 转向 · 拖拽环视 · 滚轮推拉'}
        </span>
        <span className="camera-hud" data-testid="camera-pose" data-x={pose.x.toFixed(3)} data-y={pose.y.toFixed(3)} data-z={pose.z.toFixed(3)} data-yaw={pose.yawDeg.toFixed(3)} data-pitch={pose.pitchDeg.toFixed(3)}>
          {poseLabel}
        </span>
      </div>
    </div>
  );
}
