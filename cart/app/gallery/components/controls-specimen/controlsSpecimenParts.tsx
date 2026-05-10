import { Box, Col, Row, Text } from '@reactjit/runtime/primitives';
import { CTRL, type ControlTone, toneColor, toneSoftBackground } from './controlsSpecimenTheme';

export function VerticalText(props: {
  text: string;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
  letterSpacing?: number;
}) {
  const chars = Array.from(props.text || '');
  return (
    <Col style={{ alignItems: 'center', gap: 0 }}>
      {chars.map((char, index) => (
        <Text
          key={`${char}-${index}`}
          style={{
            fontSize: props.fontSize ?? 8,
            color: props.color ?? CTRL.inkDimmer,
            fontFamily: CTRL.mono,
            fontWeight: props.fontWeight ?? 'normal',
            letterSpacing: props.letterSpacing ?? 1.2,
            lineHeight: (props.fontSize ?? 8) + 1,
          }}
        >
          {char}
        </Text>
      ))}
    </Col>
  );
}

export function AtomFrame(props: {
  children: any;
  width?: number | string;
  minHeight?: number;
  gap?: number;
  padding?: number;
  tone?: ControlTone;
  backgroundColor?: string;
  borderColor?: string;
}) {
  return (
    <Col
      style={{
        width: props.width,
        minHeight: props.minHeight,
        gap: props.gap ?? 8,
        padding: props.padding ?? 12,
        borderWidth: 1,
        borderColor: props.borderColor ?? CTRL.ruleBright,
        backgroundColor: props.backgroundColor ?? CTRL.bg2,
      }}
    >
      {props.children}
    </Col>
  );
}

export function Mono(props: {
  children: any;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
  letterSpacing?: number;
  lineHeight?: number;
  noWrap?: boolean;
  numberOfLines?: number;
  style?: any;
}) {
  return (
    <Text
      noWrap={props.noWrap}
      numberOfLines={props.numberOfLines}
      style={{
        fontFamily: CTRL.mono,
        color: props.color ?? CTRL.inkDim,
        fontSize: props.fontSize ?? 8,
        fontWeight: props.fontWeight ?? 'normal',
        letterSpacing: props.letterSpacing ?? 1.2,
        ...(props.lineHeight != null ? { lineHeight: props.lineHeight } : {}),
        ...(props.style || {}),
      }}
    >
      {props.children}
    </Text>
  );
}

export function Body(props: {
  children: any;
  color?: string;
  fontSize?: number;
  fontWeight?: string;
  lineHeight?: number;
  noWrap?: boolean;
  numberOfLines?: number;
  style?: any;
}) {
  return (
    <Text
      noWrap={props.noWrap}
      numberOfLines={props.numberOfLines}
      style={{
        color: props.color ?? CTRL.ink,
        fontSize: props.fontSize ?? 13,
        fontWeight: props.fontWeight ?? 'normal',
        ...(props.lineHeight != null ? { lineHeight: props.lineHeight } : {}),
        ...(props.style || {}),
      }}
    >
      {props.children}
    </Text>
  );
}

export function Divider(props: { color?: string; thickness?: number }) {
  return <Box style={{ width: '100%', height: props.thickness ?? 1, backgroundColor: props.color ?? CTRL.rule }} />;
}

export function StatPair(props: { label: string; value: string; tone?: ControlTone; width?: number }) {
  return (
    <Col style={{ width: props.width, gap: 2 }}>
      <Mono color={CTRL.inkDimmer}>{props.label}</Mono>
      <Mono color={toneColor(props.tone ?? 'accent')} fontSize={10} fontWeight="bold">
        {props.value}
      </Mono>
    </Col>
  );
}

export function VerticalSpine(props: {
  label: string;
  tone?: ControlTone;
  solid?: boolean;
  minWidth?: number;
  padding?: number;
  color?: string;
}) {
  const color = props.color ?? toneColor(props.tone ?? 'accent');
  return (
    <Box
      style={{
        minWidth: props.minWidth ?? 24,
        paddingTop: props.padding ?? 8,
        paddingBottom: props.padding ?? 8,
        paddingLeft: 6,
        paddingRight: 6,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: 1,
        borderColor: color,
        backgroundColor: props.solid ? color : toneSoftBackground(props.tone ?? 'accent'),
      }}
    >
      <VerticalText
        text={props.label}
        color={props.solid ? CTRL.bg : color}
        fontSize={8}
        fontWeight="bold"
        letterSpacing={1.6}
      />
    </Box>
  );
}

export function InlinePill(props: { label: string; tone?: ControlTone; solid?: boolean }) {
  const color = toneColor(props.tone ?? 'accent');
  return (
    <Box
      style={{
        paddingLeft: 8,
        paddingRight: 8,
        paddingTop: 4,
        paddingBottom: 4,
        borderWidth: 1,
        borderColor: color,
        backgroundColor: props.solid ? color : toneSoftBackground(props.tone ?? 'accent'),
      }}
    >
      <Mono color={props.solid ? CTRL.bg : color} fontSize={9} fontWeight="bold" letterSpacing={1.4} lineHeight={10} noWrap>
        {props.label}
      </Mono>
    </Box>
  );
}

export function HorizontalTicks(props: { count: number; active?: number; tone?: ControlTone }) {
  return (
    <Row style={{ width: '100%', justifyContent: 'space-between', gap: 4 }}>
      {Array.from({ length: Math.max(0, props.count) }).map((_, index) => (
        <Box
          key={index}
          style={{
            width: 1,
            height: index === props.active ? 8 : 4,
            backgroundColor: index === props.active ? toneColor(props.tone ?? 'accent') : CTRL.rule,
          }}
        />
      ))}
    </Row>
  );
}

export function MeterMarks(props: { labels: string[] }) {
  return (
    <Row style={{ width: '100%', justifyContent: 'space-between', gap: 6 }}>
      {props.labels.map((label) => (
        <Mono key={label} color={CTRL.inkGhost}>
          {label}
        </Mono>
      ))}
    </Row>
  );
}

export function SparkBars(props: {
  values: number[];
  height?: number;
  tone?: ControlTone;
  stretch?: boolean;
}) {
  return (
    <Row style={{ width: '100%', alignItems: 'flex-end', gap: 4 }}>
      {props.values.map((value, index) => {
        const height = Math.max(4, Math.round((props.height ?? 28) * Math.max(0, Math.min(1, value))));
        const accent =
          index >= props.values.length - 2
            ? CTRL.accent
            : index === props.values.length - 3
              ? 'theme:accent'
              : 'theme:accent';
        return (
          <Box
            key={index}
            style={{
              flexGrow: props.stretch ? 1 : 0,
              flexBasis: props.stretch ? 0 : undefined,
              width: props.stretch ? undefined : 22,
              height,
              backgroundColor: props.tone === 'flag' ? CTRL.flag : accent,
              borderWidth: 1,
              borderColor: CTRL.ruleBright,
            }}
          />
        );
      })}
    </Row>
  );
}

export function FramedValue(props: {
  label?: string;
  value: string;
  sub?: string;
  tone?: ControlTone;
  width?: number | string;
}) {
  return (
    <Col
      style={{
        width: props.width,
        gap: 4,
        padding: 10,
        borderWidth: 1,
        borderColor: toneColor(props.tone ?? 'accent'),
        backgroundColor: toneSoftBackground(props.tone ?? 'accent'),
      }}
    >
      {props.label ? <Mono color={CTRL.inkDimmer}>{props.label}</Mono> : null}
      <Body fontSize={18}>{props.value}</Body>
      {props.sub ? <Mono color={CTRL.inkDim}>{props.sub}</Mono> : null}
    </Col>
  );
}
