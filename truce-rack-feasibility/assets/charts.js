/* truce-rack feasibility report — charts
 * 图 2：块处理耗时 vs 实时预算（对数刻度）
 * 数据来源：PoC harness 实测（truce-rack-poc，2026-08-20）
 */
(function () {
  var INK = '#20191c';
  var MUTED = '#6d6270';
  var RULE = '#e5e0dc';
  var ACCENT = '#b5423c';
  var ACCENT2 = '#2f5d7c';
  var BUDGET = 10667; // μs, 512 帧 @ 48 kHz

  function fmtUs(v) {
    if (v >= 1000) return (v / 1000).toFixed(2) + ' ms';
    return v + ' μs';
  }

  var el = document.getElementById('chart-latency');
  if (!el || typeof echarts === 'undefined') return;
  var chart = echarts.init(el, null, { renderer: 'canvas' });

  chart.setOption({
    baseOption: {
      animationDuration: 600,
      grid: { left: 90, right: 30, top: 46, bottom: 52 },
      legend: {
        top: 6,
        left: 'center',
        itemGap: 26,
        textStyle: { color: MUTED, fontFamily: 'WorkSans, PingFang SC, Microsoft YaHei, sans-serif', fontSize: 13 },
        data: ['VST3（nih-plug gain）', 'CLAP（nih-plug gain）']
      },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        backgroundColor: 'rgba(32,25,28,0.92)',
        borderWidth: 0,
        textStyle: { color: '#ffffff', fontSize: 13 },
        valueFormatter: function (v) { return v == null ? '-' : fmtUs(v); }
      },
      xAxis: {
        type: 'category',
        data: ['平均耗时', '最坏耗时'],
        axisLine: { lineStyle: { color: RULE } },
        axisTick: { show: false },
        axisLabel: { color: INK, fontSize: 14, fontFamily: 'WorkSans, PingFang SC, Microsoft YaHei, sans-serif' }
      },
      yAxis: {
        type: 'log',
        logBase: 10,
        min: 0.5,
        max: 20000,
        name: '耗时（对数刻度）',
        nameTextStyle: { color: MUTED, fontSize: 12, padding: [0, 0, 6, 0] },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: RULE, type: 'dashed' } },
        axisLabel: {
          color: MUTED,
          fontSize: 12,
          formatter: function (v) {
            if (v >= 1000) return (v / 1000) + 'ms';
            return v + 'μs';
          }
        }
      },
      series: [
        {
          name: 'VST3（nih-plug gain）',
          type: 'bar',
          barWidth: 44,
          itemStyle: { color: ACCENT, borderRadius: [3, 3, 0, 0] },
          label: {
            show: true,
            position: 'top',
            color: INK,
            fontSize: 12,
            fontFamily: 'JetBrainsMono, Consolas, monospace',
            formatter: function (p) { return p.value + ' μs'; }
          },
          data: [1.1, 8.3]
        },
        {
          name: 'CLAP（nih-plug gain）',
          type: 'bar',
          barWidth: 44,
          itemStyle: { color: ACCENT2, borderRadius: [3, 3, 0, 0] },
          label: {
            show: true,
            position: 'top',
            color: INK,
            fontSize: 12,
            fontFamily: 'JetBrainsMono, Consolas, monospace',
            formatter: function (p) { return p.value + ' μs'; }
          },
          data: [1.4, 12.3],
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: INK, type: 'dashed', width: 1.5 },
            label: {
              position: 'insideEndTop',
              color: INK,
              fontSize: 12,
              fontWeight: 600,
              formatter: '实时预算 10 667 μs（512 帧 @ 48 kHz）'
            },
            data: [{ yAxis: BUDGET }]
          }
        }
      ]
    }
  });

  window.addEventListener('resize', function () { chart.resize(); });
})();
