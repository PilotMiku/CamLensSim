import { useEffect, useRef } from 'react';
import { Icon } from './Icon';

export function HelpDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open) dialog.current?.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="help-dialog"
      onCancel={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      aria-labelledby="help-title"
    >
      <button className="dialog-close" aria-label="关闭帮助" onClick={onClose}>
        <Icon name="close" />
      </button>
      <span className="eyebrow">A LITTLE OPTICS, A LOT TO EXPLORE</span>
      <h2 id="help-title">从一束光开始。</h2>
      <p className="help-intro">
        一间可随时重来的摄影实验室。试着一次只改变一个参数，看看画面和数据如何响应。
      </p>
      <div className="help-item">
        <Icon name="lens" />
        <div>
          <h3>焦距、传感器与视角</h3>
          <p>
            焦距越长、传感器越小，取景范围越窄。改变机位会改变透视；只改变焦距不会。等效焦距只用于比较视角，不代表景深或曝光等效。
          </p>
        </div>
      </div>
      <div className="help-item">
        <Icon name="aperture" />
        <div>
          <h3>光圈、景深与衍射</h3>
          <p>
            f 数越小，景深越浅，背景光斑越圆越大；收小光圈后景深变深，但 f/16 之后衍射会让整个画面变软。弥散圈按传感器对角线 / 1500 计算，并与 550 nm 的艾里斑合成。
          </p>
        </div>
      </div>
      <div className="help-item">
        <Icon name="move" />
        <div>
          <h3>自由机位</h3>
          <p>
            键盘 <kbd>W</kbd>
            <kbd>A</kbd>
            <kbd>S</kbd>
            <kbd>D</kbd> 前后左右移动，<kbd>J</kbd>
            <kbd>K</kbd> 水平转向，<kbd>I</kbd>
            <kbd>O</kbd> 俯仰，<kbd>R</kbd>
            <kbd>F</kbd> 升降，<kbd>Shift</kbd> 加速。拖拽画面环视，滚轮推拉；手机端使用左移动、右转向的虚拟摇杆。
          </p>
        </div>
      </div>
      <div className="help-item">
        <Icon name="focus" />
        <div>
          <h3>对焦与曝光</h3>
          <p>
            点按画面中的物体即可对焦。对焦距离可设至 100 km，也可点击「对焦到无穷远 ∞」；无穷远时移动机位保持手动对焦。开启「自动跟焦」后焦点锚定在物体上，移动机位会自动重算对焦距离。「恒定曝光预览」固定显示曝光倍率；关闭后可用光圈、快门与 ISO 观察相对曝光变化，倍率不截断。极端曝光在显示端可能变白或变黑；快门暂不产生运动模糊。
          </p>
        </div>
      </div>
      <div className="help-item">
        <Icon name="lens" />
        <div>
          <h3>移轴与倾斜焦平面</h3>
          <p>
            镜头倾角与焦平面倾角不同。固定倾角后，改变对焦距离会使焦平面绕铰链线旋转。倾斜景深呈楔形，界面数值只表示光轴截面；零倾角超焦距作为参考。对焦距离为焦平面与光轴的交点，点按跟焦也会考虑物体高度。
          </p>
        </div>
      </div>
      <div className="help-item">
        <Icon name="sun" />
        <div>
          <h3>进光量、ISO 与噪声</h3>
          <p>
            延长曝光或开大光圈会收集更多光子，改善信噪比；ISO 放大信号和噪声，本身不增加光子。提高 ISO 并缩短快门以保持亮度时，噪声会加重。实时与光追使用同一套散粒噪声与读出噪声近似，按相同像素数比较画幅；这是虚拟传感器，不代表任何实际器材。参数或机位变化时生成新样本，静止时保持稳定。
          </p>
        </div>
      </div>
      <div className="help-model">
        <strong>太阳与阴影</strong>
        <p>
          太阳视直径约 0.53°。光追按远距离太阳圆面采样：遮挡物贴近受光面时阴影较硬，离开后半影逐渐变宽。实时模式使用距离相关的软阴影近似，空气光束仍是单次散射后处理。太阳位置固定为下午日照，场景亮度使用相对标定，不代表实测照度。
        </p>
        <strong>计算模型与视觉边界</strong>
        <p>
          数据使用薄透镜模型：距离以米，焦距与传感器尺寸以毫米，容许弥散圈为传感器对角线 / 1500。近界 / 远界由 q = f²/(N·c) 与超焦距导出，远界在超焦距处变为无穷远。实时画面把近景虚化作为带透明度的独立层，可扩散到清晰背景；按深度限制遮挡，并保留全分辨率焦内底图。被挡住的背景只用邻近可见颜色近似补齐，细枝叶与复杂遮挡仍可能有误差；不模拟真实像差、胶片响应、运动模糊和具体相机的噪声特性，最高散焦半径与采样数受限。
        </p>
      </div>
      <button className="primary-button" onClick={onClose}>
        开始探索
        <Icon name="arrow" size={16} />
      </button>
    </dialog>
  );
}
