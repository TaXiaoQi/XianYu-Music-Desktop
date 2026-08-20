/**
 * 插件宿主依赖包打包入口 —— 供 esbuild 打包为单个 IIFE bundle
 *
 * 该 bundle 由 Rust 插件宿主（rquickjs/QuickJS）在每个插件上下文中执行，
 * 产物挂到 globalThis.__xyPackages，由 shim.js 消费并组装 require 体系。
 *
 * 重新生成 bundle：npm run build:plugin-packages
 */

import * as cheerioNs from 'cheerio';
import * as cryptoJsNs from 'crypto-js';
import * as dayjsNs from 'dayjs';
import * as qsNs from 'qs';
import * as heNs from 'he';
import * as bigIntNs from 'big-integer';
import * as axiosNs from 'axios';
import { Buffer } from 'buffer';

function unwrapMod(mod, checkProp) {
  if (!mod) return mod;
  if (checkProp && mod[checkProp]) return mod;
  if (mod.default && mod.default !== mod) {
    if (!checkProp || mod.default[checkProp] || typeof mod.default === 'function') {
      return mod.default;
    }
  }
  return mod;
}

globalThis.__xyPackages = {
  cheerio: unwrapMod(cheerioNs, 'load'),
  'crypto-js': unwrapMod(cryptoJsNs, 'SHA256'),
  dayjs: unwrapMod(dayjsNs, 'isDayjs'),
  'big-integer': unwrapMod(bigIntNs),
  qs: unwrapMod(qsNs, 'stringify'),
  he: unwrapMod(heNs, 'decode'),
  axios: unwrapMod(axiosNs),
  buffer: { Buffer },
};
