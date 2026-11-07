import { formatDistance, formatEv, formatMagnification, type OpticsResult } from '../optics/calculate';

export function OpticsReadout({ optics: o }: { optics: OpticsResult }) {
  const hyperfocal = o.hyperfocalM >= 100 ? o.hyperfocalM.toFixed(0) : o.hyperfocalM.toFixed(2);
  const projection =
    o.lensKind === 'fisheye'
      ? '鱼眼 · 对角 ' + o.fisheyeDiagonalDeg.toFixed(1) + '°'
      : o.lensKind === 'tilt-shift'
        ? '移轴 T/S'
        : o.lensKind === 'mirror'
          ? '折返 · 环形光斑'
          : '直线透视';
  return (
    <section className="optics-readout" aria-label="实时光学数据" aria-live="off">
      <div className="metric">
        <span>
          水平视角 <small>FOV</small>
        </span>
        <strong data-testid="horizontal-fov">
          {(o.lensKind === 'fisheye' ? o.fisheyeHorizontalDeg : o.horizontalFovDeg).toFixed(1)}
          <em>°</em>
        </strong>
        <p>
          {o.lensKind === 'fisheye'
            ? '垂直 ' + o.fisheyeVerticalDeg.toFixed(1) + '° · 对角 ' + o.fisheyeDiagonalDeg.toFixed(1) + '°'
            : '垂直 ' + o.verticalFovDeg.toFixed(1) + '° · 对角 ' + o.diagonalFovDeg.toFixed(1) + '°'}
        </p>
      </div>
      <div className="metric">
        <span>35mm 等效焦距</span>
        <strong data-testid="equivalent-focal">
          {o.equivalentFocalMm.toFixed(1)}
          <em>mm</em>
        </strong>
        <p>传感器裁切系数 {o.cropFactor.toFixed(2)}×</p>
      </div>
      <div className="metric">
        <span>
          {o.lensKind === 'fisheye' ? '径向景深近似' : o.tilted ? '光轴截面景深' : '总景深'} <small>DOF</small>
        </span>
        <strong data-testid="total-dof">
          {Number.isFinite(o.totalM) ? o.totalM.toFixed(2) : '∞'}
          <em>{Number.isFinite(o.totalM) ? 'm' : ''}</em>
        </strong>
        <p>
          {formatDistance(o.nearM)} — {formatDistance(o.farM)}
        </p>
      </div>
      <div className="metric">
        <span>
          {o.tilted ? '零倾角超焦距参考' : '超焦距'} <small>H</small>
        </span>
        <strong>
          {hyperfocal}
          <em>m</em>
        </strong>
        <p>容许弥散圈 {o.cocMm.toFixed(3)} mm</p>
      </div>
      <p className="optics-detail">
        {projection}
        {o.lensKind !== 'fisheye' && ` · 对焦延伸视角 ${o.workingHorizontalFovDeg.toFixed(1)}°`}
        {o.tilted && ` · 焦平面倾角 ${o.focusPlaneTiltDeg.toFixed(1)}°（相对传感器）`}
        {' · 放大率 '}
        <span data-testid="magnification" title="薄透镜近轴模型的像物尺寸比；1× 表示等大成像，移轴时为光轴交点处的水平倍率。">
          {formatMagnification(o.magnification)}
        </span>{' '}
        · 衍射斑 {o.diffractionMm.toFixed(3)} mm · EV₁₀₀ {formatEv(o.ev100)} · 距主体{' '}
        {o.subjectDistanceM.toFixed(2)} m
      </p>
    </section>
  );
}
