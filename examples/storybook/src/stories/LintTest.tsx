import React from 'react';
import { Box, Text } from '@ilovereact/core';

const LintTest: React.FC = () => {
  // Pixel art sun icon (8x8 grid)
  const SunIcon = () => {
    const sunGrid = [
      [0, 0, 0, 1, 1, 0, 0, 0],
      [0, 1, 1, 1, 1, 1, 1, 0],
      [0, 1, 2, 2, 2, 2, 1, 0],
      [1, 1, 2, 2, 2, 2, 1, 1],
      [1, 1, 2, 2, 2, 2, 1, 1],
      [0, 1, 2, 2, 2, 2, 1, 0],
      [0, 1, 1, 1, 1, 1, 1, 0],
      [0, 0, 0, 1, 1, 0, 0, 0],
    ];

    const colors = ['transparent', '#FFA500', '#FFD700'];

    return (
      <Box style={{ flexDirection: 'column', gap: 1 }}>
        {sunGrid.map((row, i) => (
          <Box key={i} style={{ flexDirection: 'row', gap: 1 }}>
            {row.map((cell, j) => (
              <Box
                key={j}
                style={{
                  width: 10,
                  height: 10,
                  backgroundColor: colors[cell],
                }}
              />
            ))}
          </Box>
        ))}
      </Box>
    );
  };

  // Pixel art cloud icon (6x4 grid)
  const CloudIcon = () => {
    const cloudGrid = [
      [0, 1, 1, 1, 0, 0],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 1, 1],
    ];

    return (
      <Box style={{ flexDirection: 'column', gap: 1 }}>
        {cloudGrid.map((row, i) => (
          <Box key={i} style={{ flexDirection: 'row', gap: 1 }}>
            {row.map((cell, j) => (
              <Box
                key={j}
                style={{
                  width: 8,
                  height: 8,
                  backgroundColor: cell ? '#E0E7FF' : 'transparent',
                }}
              />
            ))}
          </Box>
        ))}
      </Box>
    );
  };

  const StatItem = ({ label, value }: { label: string; value: string }) => (
    <Box
      style={{
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        padding: 12,
        borderRadius: 8,
        gap: 4,
      }}
    >
      <Text style={{ fontSize: 12, color: '#A5B4FC', opacity: 0.8 }}>
        {label}
      </Text>
      <Text style={{ fontSize: 18, color: '#E0E7FF', fontWeight: '600' }}>
        {value}
      </Text>
    </Box>
  );

  const ForecastDay = ({
    day,
    high,
    low,
    condition,
  }: {
    day: string;
    high: number;
    low: number;
    condition: string;
  }) => (
    <Box
      style={{
        flexGrow: 1,
        backgroundColor: 'rgba(255, 255, 255, 0.05)',
        padding: 16,
        borderRadius: 8,
        gap: 8,
        alignItems: 'center',
      }}
    >
      <Text style={{ fontSize: 14, color: '#A5B4FC', fontWeight: '600' }}>
        {day}
      </Text>
      <Text style={{ fontSize: 12, color: '#E0E7FF', opacity: 0.7 }}>
        {condition}
      </Text>
      <Box style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
        <Text style={{ fontSize: 16, color: '#FCA5A5', fontWeight: '600' }}>
          {high}°
        </Text>
        <Text style={{ fontSize: 16, color: '#93C5FD', fontWeight: '600' }}>
          {low}°
        </Text>
      </Box>
    </Box>
  );

  return (
    <Box
      style={{
        flexGrow: 1,
        background: 'linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #4c1d95 100%)',
        padding: 24,
        gap: 24,
      }}
    >
      {/* Main content area */}
      <Box style={{ flexDirection: 'row', gap: 24, flexGrow: 1 }}>
        {/* Left section - Current weather */}
        <Box
          style={{
            flexGrow: 2,
            backgroundColor: 'rgba(255, 255, 255, 0.08)',
            borderRadius: 16,
            padding: 32,
            gap: 24,
            justifyContent: 'center',
          }}
        >
          <Box style={{ gap: 16 }}>
            <SunIcon />
            <Text
              style={{
                fontSize: 72,
                color: '#FFFFFF',
                fontWeight: '700',
                marginTop: 16,
              }}
            >
              72°F
            </Text>
            <Text style={{ fontSize: 24, color: '#A5B4FC', fontWeight: '500' }}>
              Sunny & Clear
            </Text>
            <Text style={{ fontSize: 14, color: '#E0E7FF', opacity: 0.6, marginTop: 8 }}>
              San Francisco, CA
            </Text>
          </Box>
        </Box>

        {/* Right section - Stats */}
        <Box style={{ flexGrow: 1, gap: 12 }}>
          <StatItem label="Humidity" value="45%" />
          <StatItem label="Wind Speed" value="12 mph" />
          <StatItem label="Pressure" value="1013 hPa" />
          <StatItem label="UV Index" value="6 (High)" />
          
          {/* Cloud cover section */}
          <Box
            style={{
              flexGrow: 1,
              backgroundColor: 'rgba(255, 255, 255, 0.05)',
              padding: 12,
              borderRadius: 8,
              gap: 8,
            }}
          >
            <Text style={{ fontSize: 12, color: '#A5B4FC', opacity: 0.8 }}>
              Cloud Cover
            </Text>
            <Box style={{ alignItems: 'center', justifyContent: 'center', flexGrow: 1 }}>
              <CloudIcon />
            </Box>
            <Text style={{ fontSize: 18, color: '#E0E7FF', fontWeight: '600', textAlign: 'center' }}>
              20%
            </Text>
          </Box>
        </Box>
      </Box>

      {/* 5-day forecast strip */}
      <Box
        style={{
          flexDirection: 'row',
          gap: 12,
          backgroundColor: 'rgba(255, 255, 255, 0.03)',
          padding: 16,
          borderRadius: 16,
        }}
      >
        <ForecastDay day="Mon" high={74} low={58} condition="Sunny" />
        <ForecastDay day="Tue" high={71} low={56} condition="Cloudy" />
        <ForecastDay day="Wed" high={68} low={54} condition="Rain" />
        <ForecastDay day="Thu" high={70} low={55} condition="Partly Cloudy" />
        <ForecastDay day="Fri" high={73} low={57} condition="Sunny" />
      </Box>
    </Box>
  );
};

export default LintTest;
