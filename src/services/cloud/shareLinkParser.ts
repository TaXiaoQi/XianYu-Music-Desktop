// 移植自移动端 lib/src/cloud/share_link_parser.dart
// 分享链接归属识别：输入任意分享 URL，识别属于哪张盘并提取分享码/提取码。
// 具体解析（列文件/转存/直链）由各 provider.parseShareLink 完成。

export class ShareLinkInfo {
  readonly providerId: string;

  /** 各盘分享标识（surl / pwd_id / shareCode…）。 */
  readonly shareId: string;
  readonly passcode: string | null;
  readonly url: string;

  constructor(init: {
    providerId: string;
    shareId: string;
    passcode?: string | null;
    url: string;
  }) {
    this.providerId = init.providerId;
    this.shareId = init.shareId;
    this.passcode = init.passcode ?? null;
    this.url = init.url;
  }
}

/** 按域名/路径正则逐盘匹配；未识别返回 null。 */
export function parseUrlToProvider(raw: string): ShareLinkInfo | null {
  const url = raw.trim();
  if (url === '') return null;

  // 百度：pan.baidu.com/s/1xxxx（surl= 与短链 #/s/1xxx）
  let m = /pan\.baidu\.com\/(?:s\/1|#\/s\/1|\?surl=|share\/init\?surl=)([A-Za-z0-9_-]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'baidu',
      shareId: m[1] as string,
      passcode: queryParam(url, 'pwd'),
      url,
    });
  }

  // 阿里：www.alipan.com/s/xxx / www.aliyundrive.com/s/xxx
  m = /(?:alipan|aliyundrive)\.com\/(?:s|#\/s)\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'aliyun',
      shareId: m[1] as string,
      passcode: queryParam(url, 'pwd'),
      url,
    });
  }

  // 夸克：pan.quark.cn/s/xxx（#提取码）
  m = /pan\.quark\.cn\/s\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'quark',
      shareId: m[1] as string,
      passcode: trailingPwd(url) ?? queryParam(url, 'pwd'),
      url,
    });
  }

  // UC：drive.uc.cn/s/xxx
  m = /drive\.uc\.cn\/s\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'uc',
      shareId: m[1] as string,
      passcode: trailingPwd(url) ?? queryParam(url, 'pwd'),
      url,
    });
  }

  // 天翼：cloud.189.cn/t/xxx（web 分享）/ content 相关链接
  m = /cloud\.189\.cn\/(?:t|web\/share)\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'ecloud189',
      shareId: m[1] as string,
      passcode: queryParam(url, 'accessCode'),
      url,
    });
  }

  // 139：yun.139.com/shareweb/#/w/i/xxx
  m = /yun\.139\.com\/shareweb\/#\/w\/i\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'mobile139',
      shareId: m[1] as string,
      passcode: queryParam(url, 'pwd'),
      url,
    });
  }

  // 迅雷：pan.xunlei.com/s/xxx#提取码
  m = /pan\.xunlei\.com\/s\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'thunder',
      shareId: m[1] as string,
      passcode: trailingPwd(url),
      url,
    });
  }

  // 123 盘：123pan.com / 123684 / 123865 / 123912 等域名 /s/xxx-提取码
  m = /(?:123pan|123684|123865|123912|123685)\.(?:com|cn)\/s\/([A-Za-z0-9]+)(?:-([A-Za-z0-9]+))?/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'pan123',
      shareId: m[1] as string,
      passcode: (m[2] as string) ?? queryParam(url, 'pwd'),
      url,
    });
  }

  // PikPak：mypikpak.com/s/xxx
  m = /mypikpak\.com\/s\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'pikpak',
      shareId: m[1] as string,
      passcode: trailingPwd(url),
      url,
    });
  }

  // 蓝奏：lanzou[xiouu]/lanzn/lanvf/lanpv 等域名 /s/ 或 /#/s/
  m = /lanzou[a-z]?\.com\/(?:s\/|#(?:\/s\/))([A-Za-z0-9]+)|lanz(?:n|vf|pv|ou?i|ou?u|ou?x|ou?e)\.(?:com|net|org)\/(?:s\/|#(?:\/s\/))([A-Za-z0-9]+)/.exec(url);
  if (m) {
    const id = (m[1] ?? m[2]) as string;
    return new ShareLinkInfo({
      providerId: 'lanzou',
      shareId: id,
      passcode: queryParam(url, 'pwd'),
      url,
    });
  }

  // 微云：share.weiyun.com/xxx
  m = /share\.weiyun\.com\/([A-Za-z0-9]+)/.exec(url);
  if (m) {
    return new ShareLinkInfo({
      providerId: 'weiyun',
      shareId: m[1] as string,
      passcode: queryParam(url, 'pwd'),
      url,
    });
  }

  return null;
}

function queryParam(url: string, key: string): string | null {
  const idx = url.indexOf('?');
  if (idx < 0) return null;
  const q = url.substring(idx + 1);
  for (const seg of q.split(/[#&]/)) {
    const kv = seg.split('=');
    if (kv.length === 2 && kv[0] === key && kv[1] !== '') {
      return decodeURIComponent(kv[1] as string);
    }
  }
  return null;
}

/** `.../s/xxx#提取码` 形式的尾缀提取码。 */
function trailingPwd(url: string): string | null {
  const hashIdx = url.indexOf('#');
  if (hashIdx < 0) return null;
  const tail = url.substring(hashIdx + 1).trim();
  if (tail === '' || tail.includes('/')) return null;
  if (tail.startsWith('访问码:') || tail.startsWith('pwd=')) {
    return tail.split(':').pop()?.split('=').pop() ?? null;
  }
  return tail;
}
