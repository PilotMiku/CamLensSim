import { axialDistanceOrNull, radialDistance, subjectDistance } from '../domain/camera';
import { formatDistance, type OpticsResult } from '../optics/calculate';
import { getScene } from '../scenes/registry';
import { useSimulator } from '../state/simulator';
import { Icon } from './Icon';

export function DepthDiagram({ optics, sceneId }: { optics: OpticsResult; sceneId: string }) {
  const {
    state: { parameters: p },
    dispatch,
  } = useSimulator();
  const pose = p.pose;
  const fisheye = optics.lensKind === 'fisheye';
  const entries = getScene(sceneId).landmarks.map((mark) => ({
    mark,
    distance: fisheye ? radialDistance(pose, mark.position) : axialDistanceOrNull(pose, mark.position),
  }));
  const max = Math.max(
    8,
    Number.isFinite(p.focusDistanceM) ? p.focusDistanceM * 1.2 : optics.nearM * 1.2,
    subjectDistance(pose) + 2.5,
    ...entries.map((entry) => (entry.distance ? entry.distance * 1.12 : 0)),
  );
  const position = (m: number) => Math.min(100, Math.max(0, (m / max) * 100));
  return (
    <section className="depth-module" aria-label="景深距离示意">
      <div className="depth-heading">
        <div>
          <Icon name="focus" size={16} />
          <h2>清晰，发生在哪里</h2>
        </div>
        <span>{fisheye ? '径向距离 · m' : optics.tilted ? '仅光轴截面 · m' : '沿光轴距离 · m'}</span>
      </div>
      {fisheye && <p className="parameter-note">
        鱼眼以到相机的直线距离近似球面景深；实际镜头的像场弯曲和像差未建模。
      </p>}
      {optics.tilted && <p className="parameter-note">
        倾斜景深呈楔形，不同高度的清晰距离不同。此图仅展示光轴截面，物体标记仍表示其沿光轴距离。
      </p>}
      <div className="depth-track-area">
        <div className="depth-track">
          <div
            className="depth-zone"
            style={{
              left: `${position(optics.nearM)}%`,
              width: `${Math.max(0.15, position(optics.farM) - position(optics.nearM))}%`,
            }}
          />
          <div className="focus-marker" style={{ left: `${position(p.focusDistanceM)}%` }}>
            <span>对焦 {formatDistance(p.focusDistanceM)}</span>
            <i />
          </div>
          {[0, 0.25, 0.5, 0.75, 1].map((t) => (
            <span className="distance-tick" key={t} style={{ left: `${t * 100}%` }}>
              <i />
              {(max * t).toFixed(max > 20 ? 0 : 1)}
            </span>
          ))}
        </div>
        <div className="landmark-row">
          {entries.map(({ mark, distance }, index) => (
            <button
              key={mark.id}
              className="landmark"
              style={{
                left: `${distance ? position(distance) : 100}%`,
                top: index % 2 === 0 ? 0 : 27,
              }}
              disabled={distance === null}
              onClick={() => dispatch({ type: 'focusAtPoint', point: mark.position })}
              title={distance === null ? '该物体位于相机后方' : `对焦到${mark.label}`}
            >
              <span className="landmark-dot" />
              {mark.label}
              <small>{distance === null ? '后方' : `${distance.toFixed(1)} m`}</small>
            </button>
          ))}
        </div>
      </div>
      <div className="depth-summary">
        <span>
          <i />
          {optics.tilted ? '光轴上的可接受清晰范围' : '可接受清晰范围'}
        </span>
        <strong>
          {formatDistance(optics.nearM)}
          <Icon name="arrow" size={13} />
          {formatDistance(optics.farM)}
        </strong>
      </div>
    </section>
  );
}
