import React from "react";
import { Box, Text } from "../ilovereact/shared/src";

const LINES = [
  '                  ###     ###                  ',
  '                  ##### #####                  ',
  '                 ##   ###   ##                 ',
  '                 ##   ###   ##                 ',
  '                 ##  ## ##  ##                 ',
  '                 #############                 ',
  '               #######   #######               ',
  '              ##  ### ### ###  ##              ',
  '              #    ## ### ##    #              ',
  '              #    #  ###  #    #              ',
  '              ##  ### ### ###  ##              ',
  '               #######   #######               ',
  '                 #############                 ',
  '                 ##  #####  ##                 ',
  '                 ##   ###   ##                 ',
  '                 ##   ###   ##                 ',
  '                  # ### ##  #                  ',
  '                  ####   ####                  ',
];

const GRID = LINES.map(line => [...line].map(ch => ch !== ' '));

const PX = 12;
const COLS = 47;
const ROWS = LINES.length;
const COLOR = '#ff2d95';

export default function App() {
  return (
    <Box style={{
      width: '100%',
      height: '100%',
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: '#0a0a1a',
    }}>
      <Box style={{ width: COLS * PX, height: ROWS * PX }}>
        {GRID.map((row, r) => (
          <Box key={r} style={{ flexDirection: "row", justifyContent: "start" }}>
            {row.map((filled, c) => (
              <Box key={c} style={{
                width: PX,
                height: PX,
                backgroundColor: filled ? COLOR : 'transparent',
              }} />
            ))}
          </Box>
        ))}
      </Box>
      <Box style={{ marginTop: 24, flexDirection: 'row', justifyContent: 'center', width: '100%' }}>
        <Text style={{ fontSize: 28, color: '#e2e8f0', fontWeight: '700' }}>i</Text>
        <Text style={{ fontSize: 28, color: '#ff2d95', fontWeight: '700' }}>Love</Text>
        <Text style={{ fontSize: 28, color: '#61dafb', fontWeight: '700' }}>React</Text>
      </Box>
      <Box style={{ marginTop: 8, alignItems: 'center' }}>
        <Text style={{ fontSize: 13, color: '#475569' }}>
          write it in react, render it anywhere
        </Text>
      </Box>
    </Box>
  );
}
