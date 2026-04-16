'use client';

// =============================================================
// Price Chart — TradingView Lightweight Charts v5
// =============================================================
// Renders trade price history for a market as a line chart.
// Uses each trade's execution price as a data point.
// Auto-resizes on window resize. Pure client-side, zero API.
// =============================================================

import { useEffect, useRef } from 'react';
import {
  createChart,
  LineSeries,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';

interface Trade {
  price: number | string;
  outcome: 'YES' | 'NO' | string;
  platform_timestamp: string;
}

interface PriceChartProps {
  trades: Trade[];
  height?: number;
}

export function PriceChart({ trades, height = 280 }: PriceChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const yesSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  // Create chart
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: '#9ca3af',
        fontSize: 11,
      },
      grid: {
        vertLines: { color: 'rgba(55, 65, 81, 0.3)' },
        horzLines: { color: 'rgba(55, 65, 81, 0.3)' },
      },
      crosshair: {
        mode: CrosshairMode.Magnet,
        vertLine: { color: '#10b981', width: 1, style: 3 },
        horzLine: { color: '#10b981', width: 1, style: 3 },
      },
      rightPriceScale: {
        borderColor: 'rgba(55, 65, 81, 0.5)',
        scaleMargins: { top: 0.1, bottom: 0.1 },
      },
      timeScale: {
        borderColor: 'rgba(55, 65, 81, 0.5)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScroll: true,
      handleScale: true,
    });

    const yesSeries = chart.addSeries(LineSeries, {
      color: '#10b981',
      lineWidth: 2,
      priceFormat: {
        type: 'custom',
        formatter: (p: number) => `$${p.toFixed(3)}`,
        minMove: 0.001,
      },
      title: 'YES price',
      lastValueVisible: true,
      priceLineVisible: true,
      priceLineColor: '#10b981',
      priceLineStyle: 2,
    });

    chartRef.current = chart;
    yesSeriesRef.current = yesSeries;

    // Handle window resize
    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: containerRef.current.clientWidth,
        });
      }
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
      chartRef.current = null;
      yesSeriesRef.current = null;
    };
  }, [height]);

  // Update data when trades change
  useEffect(() => {
    if (!yesSeriesRef.current || trades.length === 0) return;

    // Convert trades → chart points, sorted by time, deduplicated by second
    const pointsMap = new Map<number, number>();
    for (const trade of trades) {
      const ts = Math.floor(new Date(trade.platform_timestamp).getTime() / 1000);
      const rawPrice = typeof trade.price === 'string' ? parseFloat(trade.price) : trade.price;
      if (isNaN(rawPrice)) continue;
      // Convert NO trades to YES-equivalent price (since YES + NO = 1)
      const yesPrice = trade.outcome === 'NO' ? 1 - rawPrice : rawPrice;
      pointsMap.set(ts, yesPrice);
    }

    const points = Array.from(pointsMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([time, value]) => ({ time: time as Time, value }));

    if (points.length > 0) {
      yesSeriesRef.current.setData(points);
      chartRef.current?.timeScale().fitContent();
    }
  }, [trades]);

  return (
    <div className="bg-gray-900/50 border border-gray-800 rounded-xl overflow-hidden">
      <div className="px-5 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Price History</h2>
        <span className="text-xs text-gray-500">
          {trades.length} trade{trades.length !== 1 ? 's' : ''}
        </span>
      </div>
      {trades.length === 0 ? (
        <div className="p-8 text-center text-gray-600 text-sm">
          Not enough trade data to chart
        </div>
      ) : (
        <div ref={containerRef} className="w-full" style={{ height }} />
      )}
    </div>
  );
}
