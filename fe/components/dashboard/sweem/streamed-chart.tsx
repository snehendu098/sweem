"use client";

import { Area, AreaChart, CartesianGrid, XAxis } from "recharts";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

// Mock streamed-volume series (placeholder data) for the dashboard analytics card.
const data = [
  { month: "Jan", streamed: 1200 },
  { month: "Feb", streamed: 2100 },
  { month: "Mar", streamed: 1650 },
  { month: "Apr", streamed: 2980 },
  { month: "May", streamed: 2400 },
  { month: "Jun", streamed: 3720 },
  { month: "Jul", streamed: 3280 },
];

const chartConfig = {
  streamed: { label: "Streamed", color: "#2563eb" },
} satisfies ChartConfig;

export function StreamedChart() {
  return (
    <ChartContainer config={chartConfig} className="mt-4 h-[230px] w-full">
      <AreaChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 0 }}>
        <defs>
          <linearGradient id="fillStreamed" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="var(--color-streamed)" stopOpacity={0.35} />
            <stop offset="95%" stopColor="var(--color-streamed)" stopOpacity={0.03} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} strokeDasharray="3 3" stroke="#eef2f7" />
        <XAxis
          dataKey="month"
          tickLine={false}
          axisLine={false}
          tickMargin={10}
          fontSize={12}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator="line" />} />
        <Area
          dataKey="streamed"
          type="natural"
          stroke="var(--color-streamed)"
          strokeWidth={2}
          fill="url(#fillStreamed)"
        />
      </AreaChart>
    </ChartContainer>
  );
}
