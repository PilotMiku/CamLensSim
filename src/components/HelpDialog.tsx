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
            点按画面中的物体即可对焦。开启「自动跟焦」后焦点锚定在物体上，移动机位会自动重算对焦距离。开启「恒定曝光预览」时只改变景深、不改变亮度；关闭后可用光圈、快门与 ISO 观察曝光变化。
          </p>
        </div>
      </div>
      <div className="help-model">
        <strong>计算模型与视觉边界</strong>
        <p>
          数据使用薄透镜模型：距离以米，焦距与传感器尺寸以毫米，容许弥散圈为传感器对角线 / 1500。近界 / 远界由 q = f²/(N·c) 与超焦距导出，远界在超焦距处变为无穷远。画面使用带符号弥散圈、光圈叶片多边形核与衍射的屏幕空间散焦，保留完整分辨率的焦内细节；仍不模拟真实像差、胶片响应、运动模糊与传感器读出噪声，最高散焦半径与采样数受限。
        </p>
      </div>
      <button className="primary-button" onClick={onClose}>
        开始探索
        <Icon name="arrow" size={16} />
      </button>
    </dialog>
  );
}
