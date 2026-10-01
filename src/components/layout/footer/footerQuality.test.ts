import { describe, expect, it } from "vitest";

import type { QualityKey, Song } from "../../../types";
import { ALL_QUALITY_KEYS } from "../../../types";
import {
  ALL_QUALITY_OPTIONS,
  compactFileSize,
  getAudioExtLabel,
  localFormatLabel,
  localQualityLabel,
  qualityAbbr,
  resolveEffectiveDownloadQuality,
} from "./footerQuality";

const asSong = (partial: Partial<Song>) => partial as Song;

describe("qualityAbbr", () => {
  it("maps known quality keys to their compact abbreviation", () => {
    expect(qualityAbbr("320k")).toBe("HQ");
    expect(qualityAbbr("flac24bit")).toBe("HR");
    expect(qualityAbbr("master")).toBe("MS");
  });

  it("falls back to HQ for missing or unknown keys", () => {
    expect(qualityAbbr(undefined)).toBe("HQ");
    expect(qualityAbbr(null)).toBe("HQ");
    expect(qualityAbbr("nope" as QualityKey)).toBe("HQ");
  });
});

describe("ALL_QUALITY_OPTIONS", () => {
  it("lists every quality key in ascending rank order", () => {
    expect(ALL_QUALITY_OPTIONS.map(option => option.value)).toEqual(ALL_QUALITY_KEYS);
  });
});

describe("compactFileSize", () => {
  it("shortens the unit suffix for MB/GB/KB", () => {
    expect(compactFileSize(1024 * 1024)).toBe("1.00M");
    expect(compactFileSize(2 * 1024 * 1024 * 1024)).toBe("2.00G");
    expect(compactFileSize(320 * 1024)).toBe("320K");
  });

  it("leaves sub-kilobyte sizes untouched", () => {
    expect(compactFileSize(512)).toBe("512 B");
  });
});

describe("getAudioExtLabel", () => {
  it("prefers the extension parsed from a valid url", () => {
    expect(getAudioExtLabel("320k", "https://cdn.example.com/a/b.flac")).toBe("FLAC");
    expect(getAudioExtLabel("320k", "https://cdn.example.com/a/b.mp3?token=1")).toBe("MP3");
  });

  it("falls back to a loose extension match when the url cannot be parsed", () => {
    expect(getAudioExtLabel("320k", "not a url.m4a?q=1")).toBe("M4A");
  });

  it("derives the label from losslessness when no url is given", () => {
    expect(getAudioExtLabel("flac")).toBe("FLAC");
    expect(getAudioExtLabel("320k")).toBe("MP3");
  });
});

describe("localFormatLabel", () => {
  it("returns an empty label without a song", () => {
    expect(localFormatLabel(null)).toBe("");
  });

  it("prefers declared format metadata over the file extension", () => {
    expect(localFormatLabel(asSong({ format: "flac", path: "/music/a.mp3" }))).toBe("FLAC");
    expect(localFormatLabel(asSong({ codec: "alac" }))).toBe("ALAC");
    expect(localFormatLabel(asSong({ container: "ogg" }))).toBe("OGG");
  });

  it("falls back to the file extension", () => {
    expect(localFormatLabel(asSong({ path: "/music/a.WAV" }))).toBe("WAV");
  });
});

describe("localQualityLabel", () => {
  it("defaults to HQ without a song", () => {
    expect(localQualityLabel(null)).toBe("HQ");
  });

  it("treats 24-bit audio as Hi-Res", () => {
    expect(localQualityLabel(asSong({ bit_depth: 24, format: "flac", path: "/music/a.flac" }))).toBe("HR");
    expect(localQualityLabel(asSong({ bit_depth: 16, format: "flac", path: "/music/a.flac" }))).toBe("SQ");
  });

  it("treats lossless containers as SQ", () => {
    expect(localQualityLabel(asSong({ format: "FLAC" }))).toBe("SQ");
    expect(localQualityLabel(asSong({ container: "aiff" }))).toBe("SQ");
  });

  it("maps lossy bitrates onto the compact buckets", () => {
    expect(localQualityLabel(asSong({ bitrate: 320 }))).toBe("HQ");
    expect(localQualityLabel(asSong({ bitrate: 192 }))).toBe("192");
    expect(localQualityLabel(asSong({ bitrate: 128 }))).toBe("128");
    expect(localQualityLabel(asSong({ bitrate: 96 }))).toBe("LQ");
  });

  it("normalises bitrates expressed in bits per second", () => {
    expect(localQualityLabel(asSong({ bitrate: 320_000 }))).toBe("HQ");
  });

  it("falls back to the file extension when nothing else is known", () => {
    expect(localQualityLabel(asSong({ path: "/music/a.wav" }))).toBe("WAV");
  });
});

describe("resolveEffectiveDownloadQuality", () => {
  it("keeps the preferred quality when no availability is known", () => {
    expect(resolveEffectiveDownloadQuality("flac", null, "lower")).toBe("flac");
    expect(resolveEffectiveDownloadQuality("flac", [], "lower")).toBe("flac");
  });

  it("keeps the preferred quality when it is available", () => {
    expect(resolveEffectiveDownloadQuality("flac", ["320k", "flac"], "lower")).toBe("flac");
  });

  it("falls back to the nearest lower rank by default", () => {
    expect(resolveEffectiveDownloadQuality("flac", ["128k", "320k", "master"], "lower")).toBe("320k");
    expect(resolveEffectiveDownloadQuality("flac", ["128k", "320k", "master"], undefined)).toBe("320k");
  });

  it("falls back to the nearest higher rank when configured", () => {
    expect(resolveEffectiveDownloadQuality("flac", ["128k", "320k", "master"], "higher")).toBe("master");
  });

  it("clamps to the extremes when no rank exists on the requested side", () => {
    expect(resolveEffectiveDownloadQuality("mgg", ["flac"], "lower")).toBe("flac");
    expect(resolveEffectiveDownloadQuality("master", ["320k", "flac"], "higher")).toBe("flac");
  });
});
