// 环绕实现：立体声宽度控制（M/S 矩阵）
// Mid = (L + R) / 2
// Side = (L - R) / 2
// 调整 Side 后：L' = Mid + Side * width, R' = Mid - Side * width
// width = 0 → 单声道，width = 1 → 原始，width = 2 → 加宽

use super::types::SurroundParams;

pub struct Surround {
    width: f32,
    enabled: bool,
}

impl Surround {
    pub fn new(params: &SurroundParams) -> Self {
        Self {
            width: params.width.clamp(0.0, 4.0),
            enabled: params.enabled,
        }
    }

    pub fn update_params(&mut self, params: &SurroundParams) {
        self.width = params.width.clamp(0.0, 4.0);
        self.enabled = params.enabled;
    }

    /// 处理立体声帧（L, R）
    pub fn process_frame(&mut self, samples: &mut [f32]) {
        if !self.enabled || samples.len() < 2 {
            return;
        }
        // 处理所有通道对（L, R, L, R, ...）—— 仅对前两个通道应用
        let l = samples[0];
        let r = samples[1];
        let mid = (l + r) * 0.5;
        let side = (l - r) * 0.5 * self.width;
        samples[0] = mid + side;
        samples[1] = mid - side;
    }
}
