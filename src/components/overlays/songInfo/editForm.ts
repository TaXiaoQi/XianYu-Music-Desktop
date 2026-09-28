// 歌曲信息编辑表单的内存草稿结构（弹窗入口持有，子组件按字段读写）
export interface TrackEditForm {
  trackTitle: string;
  artistName: string;
  albumName: string;
  trackNo: string;
  discNo: string;
  releaseYear: string;
  newCoverPath: string | null;
  coverPreview: string;
}

export const blankTrackEditForm = (): TrackEditForm => ({
  trackTitle: '',
  artistName: '',
  albumName: '',
  trackNo: '',
  discNo: '',
  releaseYear: '',
  newCoverPath: null,
  coverPreview: '',
});
