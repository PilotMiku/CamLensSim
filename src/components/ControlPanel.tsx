import { MAX_FOCUS_M, subjectDistance } from '../domain/camera';
import { getLens, getSensor, LENSES, minFocusMeters, SENSORS } from '../data/equipment';
import { exposureValue, formatEv } from '../optics/calculate';
import { requestedFocusForPoint, useSimulator } from '../state/simulator';
import { Icon, type IconName } from './Icon';
import { ParameterControl } from './ParameterControl';

function SectionHeading({
  icon,
  title,
  caption,
}: {
  icon: IconName;
  title: string;
  caption: string;
}) {
  return (
    <div className="section-heading">
      <Icon name={icon} />
      <h3>{title}</h3>
      <span>{caption}</span>
    </div>
  );
}

function Toggle({
  label,
  pressed,
  onChange,
  description,
}: {
  label: string;
  pressed: boolean;
  onChange: (next: boolean) => void;
  description: string;
}) {
  return (
    <button
      className="toggle-row"
      aria-pressed={pressed}
      aria-label={label}
      onClick={() => onChange(!pressed)}
    >
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
      <i className="toggle" aria-hidden="true" />
    </button>
  );
}

/** Group the lens list in first-seen order for the picker. */
const LENS_GROUPS: Array<{ group: string; items: typeof LENSES }> = (() => {
  const groups: Array<{ group: string; items: typeof LENSES }> = [];
  for (const lensPreset of LENSES) {
    const found = groups.find((entry) => entry.group === lensPreset.group);
    if (found) found.items = [...found.items, lensPreset];
    else groups.push({ group: lensPreset.group, items: [lensPreset] });
  }
  return groups;
})();

export function ControlPanel() {
  const {
    state: { parameters: p },
    dispatch,
  } = useSimulator();
  const lens = getLens(p.lensId);
  const sensor = getSensor(p.sensorId);
  const set = (patch: Partial<typeof p>) => dispatch({ type: 'parameters', patch });
  const distance = subjectDistance(p.pose);
  const ev = exposureValue(p.aperture, p.shutterSeconds, p.iso);
  const minFocus = minFocusMeters(lens, p.focalLengthMm);
  const isPrime = lens.minFocalMm === lens.maxFocalMm;
  const isTiltShift = lens.kind === 'tilt-shift';
  const isMirror = lens.kind === 'mirror';
  const requestedFocus = requestedFocusForPoint(p, p.focusPoint);
  const focusLimited = p.focusTracking && (requestedFocus === null || requestedFocus < minFocus || requestedFocus > MAX_FOCUS_M);
  const focalLog = lens.maxFocalMm / lens.minFocalMm > 8;
  return (
    <aside className="control-panel" aria-label="相机参数">
      <div className="panel-title">
        <div>
          <Icon name="sliders" />
          <h2>拍摄参数</h2>
        </div>
        <span className="small-tag">手动 M</span>
      </div>
      <section className="control-section">
        <SectionHeading icon="camera" title="相机" caption="CAMERA" />
        <p className="field-label" id="sensor-label">
          传感器尺寸
        </p>
        <div className="segmented" role="group" aria-labelledby="sensor-label">
          {SENSORS.map((item) => (
            <button
              key={item.id}
              aria-pressed={p.sensorId === item.id}
              onClick={() => set({ sensorId: item.id })}
            >
              {item.name}
            </button>
          ))}
        </div>
        <div className="sensor-caption">
          <span>
            {sensor.widthMm} × {sensor.heightMm} mm
          </span>
          <span>{sensor.shortName.toUpperCase()}</span>
        </div>
      </section>
      <section className="control-section">
        <SectionHeading icon="lens" title="镜头" caption="LENS" />
        <label className="select-wrap">
          <span className="sr-only">镜头预设</span>
          <select value={p.lensId} onChange={(event) => set({ lensId: event.target.value })}>
            {LENS_GROUPS.map((group) => (
              <optgroup key={group.group} label={group.group}>
                {group.items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          <Icon name="chevron" size={14} />
        </label>
        <ParameterControl
          label="焦距"
          value={p.focalLengthMm}
          min={lens.minFocalMm}
          max={lens.maxFocalMm}
          step={1}
          unit="mm"
          onChange={(value) => set({ focalLengthMm: value })}
          disabled={isPrime}
          logarithmic={focalLog}
          marks={[String(lens.minFocalMm), String(lens.maxFocalMm) + ' mm']}
        />
        <ParameterControl
          label="光圈"
          value={p.aperture}
          min={lens.minAperture}
          max={lens.maxAperture}
          step={0.1}
          unit="f /"
          onChange={(value) => set({ aperture: value })}
          disabled={isMirror}
          logarithmic
          marks={
            isMirror
              ? ['f/8 固定']
              : ['f/' + lens.minAperture, lens.blades + ' 片光圈叶片', 'f/' + lens.maxAperture]
          }
        />
        {isTiltShift && (
          <>
            <ParameterControl
              label="倾角"
              value={p.tiltDeg}
              min={-8.5}
              max={8.5}
              step={0.1}
              unit="°"
              onChange={(value) => set({ tiltDeg: value })}
              marks={['-8.5°', '0°', '+8.5°']}
            />
            <ParameterControl
              label="水平偏移"
              value={p.shiftX * 100}
              min={-100}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => set({ shiftX: value / 100 })}
              marks={['-100%', '+100%']}
            />
            <ParameterControl
              label="垂直偏移"
              value={p.shiftY * 100}
              min={-100}
              max={100}
              step={1}
              unit="%"
              onChange={(value) => set({ shiftY: value / 100 })}
              marks={['-100%', '+100%']}
            />
          </>
        )}
        <p className="parameter-note">
          {isTiltShift
            ? '倾角通过沙姆定律改变焦平面；平移取景可在机身保持水平时拍摄高处。'
            : isMirror
              ? '折返镜头光圈固定 f/8，焦外光斑呈甜甜圈状。'
              : '最小对焦距离 ' + minFocus.toFixed(2) + ' m · 光圈按三分之一档取整'}
        </p>
      </section>
      <section className="control-section">
        <SectionHeading icon="focus" title="对焦与机位" caption="FOCUS / RIG" />
        <ParameterControl
          label="对焦距离"
          value={p.focusDistanceM}
          min={minFocus}
          max={MAX_FOCUS_M}
          step={0.01}
          unit="m"
          onChange={(value) => dispatch({ type: 'focusDistance', value })}
          logarithmic
          allowInfinity
          marks={[minFocus.toFixed(2) + ' m', '100 km', '∞']}
        />
        {isTiltShift && p.tiltDeg !== 0 && <p className="parameter-note">
          对焦距离表示焦平面与光轴的交点。正倾角使焦平面向画面上方远离相机；无穷远时仍是倾斜焦平面，并非全画面合焦。部分点超出当前倾角的调焦范围，点按后保持原焦点。
        </p>}
        {focusLimited && <p className="parameter-note" role="status">
          跟焦目标超出当前镜头或倾角的调焦范围，可减小倾角或重新选点。
        </p>}
        <button
          className="ghost-button"
          aria-pressed={p.focusDistanceM === Infinity}
          onClick={() => dispatch({ type: 'focusDistance', value: Infinity })}
        >
          对焦到无穷远 ∞
        </button>
        <Toggle
          label="自动跟焦"
          pressed={p.focusTracking}
          onChange={(next) => set({ focusTracking: next })}
          description={
            p.focusTracking ? '焦点锚定在画面物体上，随机位重算' : '手动焦距，机位移动后需重新对焦'
          }
        />
        <ParameterControl
          label="拍摄距离"
          value={distance}
          min={0.4}
          max={40}
          step={0.1}
          unit="m"
          onChange={(value) => dispatch({ type: 'subjectDistance', value })}
          logarithmic
          marks={['0.4 m', '40 m']}
        />
        <ParameterControl
          label="机位高度"
          value={p.pose.y}
          min={0.2}
          max={12}
          step={0.05}
          unit="m"
          onChange={(value) => dispatch({ type: 'pose', patch: { y: value } })}
          marks={['0.2 m', '12 m']}
        />
        <div className="rig-row">
          <span>
            <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> 移动 · <kbd>J</kbd>
            <kbd>K</kbd> 转向
          </span>
          <button
            className="ghost-button"
            aria-label="复位机位"
            onClick={() => dispatch({ type: 'resetCamera' })}
          >
            <Icon name="reset" size={13} />
            复位机位
          </button>
        </div>
        <p className="parameter-note">
          拖拽画面环视、滚轮推拉；<kbd>R</kbd>/<kbd>F</kbd> 升降，<kbd>Shift</kbd> 加速。
        </p>
      </section>
      <section className="control-section exposure-section">
        <SectionHeading icon="sun" title="曝光" caption="EXPOSURE" />
        <div className="exposure-fields">
          <label>
            ISO
            <select aria-label="ISO" value={p.iso} onChange={(event) => set({ iso: Number(event.target.value) })}>
              {[50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label>
            快门
            <select
              aria-label="快门"
              value={p.shutterSeconds}
              onChange={(event) => set({ shutterSeconds: Number(event.target.value) })}
            >
              {[30, 15, 8, 4, 2, 1, 1 / 2, 1 / 4, 1 / 8, 1 / 15, 1 / 30, 1 / 60,
                1 / 125, 1 / 250, 1 / 500, 1 / 1000, 1 / 2000, 1 / 4000, 1 / 8000].map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds >= 1 ? `${seconds} s` : `1/${Math.round(1 / seconds)} s`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Toggle
          label="恒定曝光预览"
          pressed={p.constantExposure}
          onChange={(next) => set({ constantExposure: next })}
          description={
            p.constantExposure ? '固定显示曝光倍率，便于比较景深和噪声' : '按光圈 / 快门 / ISO 改变曝光倍率'
          }
        />
        <p className="parameter-note">
          EV₁₀₀ {formatEv(ev)} · 高光经显示色调映射可能饱和；快门暂不模拟运动模糊
        </p>
        <p className="parameter-note">
          ISO 放大信号与噪声，不增加光子。提高 ISO 并缩短快门来保持亮度时，噪声更明显。不同画幅按相同像素数的虚拟传感器比较。
        </p>
      </section>
      <div className="panel-foot">
        <span className="status-dot" />
        所有计算均在浏览器本地完成
      </div>
    </aside>
  );
}
