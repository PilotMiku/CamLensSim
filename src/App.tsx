import { useEffect, useMemo, useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { DepthDiagram } from './components/DepthDiagram';
import { HelpDialog } from './components/HelpDialog';
import { Icon } from './components/Icon';
import { OpticsReadout } from './components/OpticsReadout';
import { Viewfinder } from './components/Viewfinder';
import { ReferenceDialog } from './components/ReferenceDialog';
import { getLens, getSensor } from './data/equipment';
import { calculateOptics } from './optics/calculate';
import { SCENES, getScene } from './scenes/registry';
import { useSimulator } from './state/simulator';

export function App() {
  const { state, dispatch } = useSimulator();
  const [help, setHelp] = useState(false);
  const [reference, setReference] = useState(false);
  const optics = useMemo(
    () =>
      calculateOptics(
        state.parameters,
        getSensor(state.parameters.sensorId),
        getLens(state.parameters.lensId),
      ),
    [state.parameters],
  );
  const scene = getScene(state.sceneId);
  const sceneIndex = Math.max(0, SCENES.findIndex((item) => item.id === scene.id));
  useEffect(() => {
    if (window.matchMedia('(pointer: coarse)').matches) {
      dispatch({ type: 'view', patch: { touchControls: true } });
    }
  }, [dispatch]);
  return (
    <>
      <header className="app-header">
        <a className="brand" href="#main" aria-label="CamLensSim 首页">
          <span className="brand-mark">
            <Icon name="aperture" size={27} />
          </span>
          <div>
            <span className="brand-name">
              CamLens<span>Sim</span>
            </span>
            <span className="brand-subtitle">摄影光学实验室</span>
          </div>
          <span className="version-tag">LAB 0.3</span>
        </a>
        <div className="header-right">
          <span className="header-note">看见参数背后的光学。</span>
          <button
            className="header-button"
            aria-label="重置参数"
            onClick={() => dispatch({ type: 'reset' })}
          >
            <Icon name="reset" size={16} />
            <span>重置参数</span>
          </button>
          <button className="help-button" aria-label="使用帮助" onClick={() => setHelp(true)}>
            <Icon name="help" size={19} />
          </button>
        </div>
      </header>
      <main id="main" className="app-main">
        <div className="workspace-heading">
          <div>
            <span className="eyebrow">YOUR VIRTUAL PHOTOGRAPHY LAB</span>
            <h1>让每一个参数，都看得见。</h1>
          </div>
          <div className="scene-picker">
            <span className="field-label">实验场景</span>
            <label className="select-wrap">
              <span className="scene-index">{String(sceneIndex + 1).padStart(2, '0')}</span>
              <span className="sr-only">选择场景</span>
              <select
                value={state.sceneId}
                onChange={(event) => dispatch({ type: 'scene', id: event.target.value })}
              >
                {SCENES.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
              <Icon name="chevron" size={15} />
            </label>
          </div>
        </div>
        <div className="workspace">
          <div className="workspace-center">
            <div className="scene-heading">
              <div>
                <span className="scene-number">{String(sceneIndex + 1).padStart(2, '0')} /</span>
                <h2>{scene.name}</h2>
                <span className="scene-subtitle">{scene.subtitle}</span>
              </div>
              <div className="scene-actions">
                <button className="tool-button reference-button" aria-label="查看场景参考图" onClick={() => setReference(true)}>
                  <Icon name="camera" size={15} /><span>参考图</span>
                </button>
                <label className="quality-control">
                  模式
                  <select aria-label="渲染模式" value={state.view.renderMode}
                    onChange={event => dispatch({ type: 'view', patch: { renderMode: event.target.value as 'realtime' | 'pathtraced' } })}>
                    <option value="realtime">实时</option>
                    <option value="pathtraced">光追</option>
                  </select>
                </label>
                <label className="quality-control">
                  渲染
                  <select
                    aria-label="渲染质量"
                    value={state.view.quality}
                    onChange={(event) =>
                      dispatch({
                        type: 'view',
                        patch: { quality: event.target.value as 'balanced' | 'low' },
                      })
                    }
                  >
                    <option value="balanced">均衡</option>
                    <option value="low">节能</option>
                  </select>
                </label>
              </div>
            </div>
            <Viewfinder sceneId={state.sceneId} />
            <OpticsReadout optics={optics} />
            <DepthDiagram optics={optics} sceneId={state.sceneId} />
            <div className="learning-note">
              <span className="note-icon">
                <Icon name="aperture" size={19} />
              </span>
              <div>
                <strong>试一试：切换场景，再换上 600mm 或鱼眼镜头</strong>
                <p>每个场景都有独立的光源；移轴、鱼眼、折返会改变成像方式。</p>
              </div>
              <button aria-label="了解光圈与景深" onClick={() => setHelp(true)}>
                <Icon name="arrow" size={18} />
              </button>
            </div>
          </div>
          <ControlPanel />
        </div>
      </main>
      <footer className="app-footer">
        <span>
          CamLensSim<span className="footer-separator">/</span>一个开放的摄影实验室
        </span>
        <span>
          薄透镜光学计算<span className="footer-dot">·</span>屏幕空间景深近似
        </span>
      </footer>
      <ReferenceDialog open={reference} sceneId={scene.id} onClose={() => setReference(false)} />
      <HelpDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}
