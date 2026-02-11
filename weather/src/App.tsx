import React, { useState } from 'react';
import { Box, Text, Pressable } from '../ilovereact/shared/src';

const MOCK_CITIES = [
  {
    name: 'San Francisco',
    temp: 62,
    high: 67,
    low: 54,
    condition: 'Foggy',
    humidity: 78,
    wind: '12 mph NW',
    forecast: [
      { day: 'Mon', temp: 64, condition: 'Cloudy' },
      { day: 'Tue', temp: 66, condition: 'Sunny' },
      { day: 'Wed', temp: 61, condition: 'Foggy' },
      { day: 'Thu', temp: 63, condition: 'Sunny' },
      { day: 'Fri', temp: 59, condition: 'Rainy' },
    ],
  },
  {
    name: 'New York',
    temp: 45,
    high: 50,
    low: 38,
    condition: 'Snowy',
    humidity: 65,
    wind: '18 mph NE',
    forecast: [
      { day: 'Mon', temp: 42, condition: 'Snowy' },
      { day: 'Tue', temp: 39, condition: 'Cloudy' },
      { day: 'Wed', temp: 44, condition: 'Sunny' },
      { day: 'Thu', temp: 48, condition: 'Sunny' },
      { day: 'Fri', temp: 46, condition: 'Rainy' },
    ],
  },
  {
    name: 'Miami',
    temp: 82,
    high: 86,
    low: 74,
    condition: 'Sunny',
    humidity: 70,
    wind: '8 mph SE',
    forecast: [
      { day: 'Mon', temp: 84, condition: 'Sunny' },
      { day: 'Tue', temp: 83, condition: 'Sunny' },
      { day: 'Wed', temp: 80, condition: 'Rainy' },
      { day: 'Thu', temp: 79, condition: 'Rainy' },
      { day: 'Fri', temp: 85, condition: 'Sunny' },
    ],
  },
];

function conditionColor(condition: string): string {
  switch (condition) {
    case 'Sunny': return '#facc15';
    case 'Cloudy': return '#94a3b8';
    case 'Foggy': return '#cbd5e1';
    case 'Rainy': return '#60a5fa';
    case 'Snowy': return '#e2e8f0';
    default: return '#e2e8f0';
  }
}

function tempColor(temp: number): string {
  if (temp >= 80) return '#ef4444';
  if (temp >= 60) return '#f59e0b';
  if (temp >= 40) return '#3b82f6';
  return '#8b5cf6';
}

export function App() {
  const [selectedCity, setSelectedCity] = useState(0);
  const city = MOCK_CITIES[selectedCity];

  return (
    <Box style={{
      width: '100%',
      height: '100%',
      backgroundColor: '#0f172a',
      flexDirection: 'column',
      paddingTop: 30,
      paddingBottom: 30,
      paddingLeft: 40,
      paddingRight: 40,
      gap: 24,
    }}>
      <Text style={{ color: '#e2e8f0', fontSize: 28, fontWeight: '700' }}>
        Weather
      </Text>

      {/* City selector - explicit dimensions on each button */}
      <Box style={{
        flexDirection: 'row',
        width: '100%',
        gap: 12,
        height: 36,
      }}>
        {MOCK_CITIES.map((c, i) => (
          <Pressable
            key={c.name}
            onPress={() => setSelectedCity(i)}
            style={{
              width: 130,
              height: 36,
              backgroundColor: i === selectedCity ? '#1e40af' : '#0f172a',
              paddingLeft: 16,
              paddingRight: 16,
              paddingTop: 8,
              paddingBottom: 8,
              borderRadius: 6,
              borderWidth: 1,
              borderColor: i === selectedCity ? '#3b82f6' : '#334155',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            <Text style={{ color: i === selectedCity ? '#ffffff' : '#94a3b8', fontSize: 14, fontWeight: '600' }}>
              {c.name}
            </Text>
          </Pressable>
        ))}
      </Box>

      {/* Current conditions - explicit dimensions on inner containers */}
      <Box style={{
        flexDirection: 'row',
        width: '100%',
        gap: 30,
        height: 90,
        alignItems: 'center',
      }}>
        <Box style={{ width: 160, height: 90, gap: 4 }}>
          <Text style={{ color: tempColor(city.temp), fontSize: 64, fontWeight: '700' }}>
            {city.temp}°
          </Text>
          <Text style={{ color: conditionColor(city.condition), fontSize: 18, fontWeight: '600' }}>
            {city.condition}
          </Text>
        </Box>

        <Box style={{ width: 250, height: 70, gap: 8 }}>
          <Text style={{ color: '#94a3b8', fontSize: 14 }}>
  {`High: ${city.high}°  Low: ${city.low}°`}
</Text>
          <Text style={{ color: '#94a3b8', fontSize: 14 }}>
            Humidity: {city.humidity}%
          </Text>
          <Text style={{ color: '#94a3b8', fontSize: 14 }}>
            Wind: {city.wind}
          </Text>
        </Box>
      </Box>

      <Text style={{ color: '#64748b', fontSize: 12, fontWeight: '600' }}>
        5-DAY FORECAST
      </Text>

      {/* Forecast - explicit dimensions on each card */}
      <Box style={{
        flexDirection: 'row',
        width: '100%',
        gap: 16,
        height: 90,
      }}>
        {city.forecast.map((day) => (
          <Box
            key={day.day}
            style={{
              width: 90,
              height: 90,
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#1e293b',
              paddingTop: 12,
              paddingBottom: 12,
              paddingLeft: 16,
              paddingRight: 16,
              borderRadius: 8,
              gap: 6,
            }}
          >
            <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600' }}>
              {day.day}
            </Text>
            <Text style={{ color: tempColor(day.temp), fontSize: 20, fontWeight: '700' }}>
              {`${day.temp}°`}
            </Text>
            <Text style={{ color: conditionColor(day.condition), fontSize: 11 }}>
              {day.condition}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}
