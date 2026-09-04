# Code Signing Policy

> This document describes the code signing policy for **XianYu Music (弦予音乐)** desktop application.
> It is a public commitment on how signing certificates (provided via SignPath Foundation) are used.

## Project overview

- **Project**: XianYu Music (弦予音乐) — a cross-platform desktop music player
- **Repository**: https://github.com/TaXiaoQi/XianYu-Music-Desktop
- **License**: GNU Affero General Public License v3.0 (AGPL-3.0)
- **Maintainer**: [TaXiaoQi](https://github.com/TaXiaoQi) (sole maintainer)

## What is signed

Only the official Windows installer artifacts produced by the project's own
GitHub Actions build pipeline are signed:

- Windows NSIS installer (`.exe`) built by Tauri bundler

The following are **never** signed:

- Artifacts built from pull requests or forks
- Locally built binaries
- Any third-party binaries

## How builds are triggered

All releases are built by the public, auditable GitHub Actions workflow
[`.github/workflows/release.yml`](../.github/workflows/release.yml), which is
triggered manually by the maintainer when publishing a release from the
protected `main` branch.

The build provenance is publicly visible in the
[Actions history](https://github.com/TaXiaoQi/XianYu-Music-Desktop/actions)
of the repository. The binaries attached to each GitHub Release are exactly
the ones produced by the corresponding workflow run.

## Who can request signing

Only the project maintainer (**@TaXiaoQi**) has permission to:

- Trigger the release build workflow
- Request the signing of release artifacts
- Approve signing requests in SignPath

There are no other committers with signing rights. Signed artifacts are
always attached to official GitHub Releases and the official website
https://xianyumusic.cn before distribution.

## Release approval process

1. The maintainer pushes a version tag to `main`
2. GitHub Actions builds the installer from the tagged commit
3. The workflow submits a signing request to SignPath
4. The maintainer manually reviews and approves the signing request
5. The signed installer is published to GitHub Releases and the official website

## Artifact verification

Users can verify that a downloaded installer matches the official release by
comparing its SHA-256 checksum with the one published alongside the release
assets on the GitHub Releases page.
