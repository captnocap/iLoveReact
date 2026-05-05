import type { GalleryDataReference, JsonObject } from '../../types';

function objectSchema(properties: Record<string, JsonObject>, required: string[] = Object.keys(properties)): JsonObject {
  return {
    type: 'object',
    additionalProperties: false,
    required,
    properties,
  };
}

function arraySchema(items: JsonObject): JsonObject {
  return {
    type: 'array',
    items,
  };
}

const stringSchema: JsonObject = { type: 'string' };
const numberSchema: JsonObject = { type: 'number' };
const booleanSchema: JsonObject = { type: 'boolean' };

export type CalendarQuarter = {
  id: string;
  label: string;
  ordinal: number;
};

export type CalendarMonth = {
  id: string;
  label: string;
  ordinal: number;
  quarterId: string;
};

export type CalendarDay = {
  id: string;
  label: string;
  ordinal: number;
  isWeekend: boolean;
};

export type CalendarDimension = {
  quarters: CalendarQuarter[];
  months: CalendarMonth[];
  days: CalendarDay[];
};

const calendarQuarterSchema = objectSchema({
  id: stringSchema,
  label: stringSchema,
  ordinal: numberSchema,
});

const calendarMonthSchema = objectSchema({
  id: stringSchema,
  label: stringSchema,
  ordinal: numberSchema,
  quarterId: stringSchema,
});

const calendarDaySchema = objectSchema({
  id: stringSchema,
  label: stringSchema,
  ordinal: numberSchema,
  isWeekend: booleanSchema,
});

export const calendarDimensionSchema: JsonObject = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'CalendarDimension',
  ...objectSchema({
    quarters: arraySchema(calendarQuarterSchema),
    months: arraySchema(calendarMonthSchema),
    days: arraySchema(calendarDaySchema),
  }),
};

export const calendarDimensionMockData: CalendarDimension = {
  quarters: [
    { id: 'q1', label: 'Q1', ordinal: 1 },
    { id: 'q2', label: 'Q2', ordinal: 2 },
    { id: 'q3', label: 'Q3', ordinal: 3 },
    { id: 'q4', label: 'Q4', ordinal: 4 },
  ],
  months: [
    { id: 'jan', label: 'Jan', ordinal: 1, quarterId: 'q1' },
    { id: 'feb', label: 'Feb', ordinal: 2, quarterId: 'q1' },
    { id: 'mar', label: 'Mar', ordinal: 3, quarterId: 'q1' },
    { id: 'apr', label: 'Apr', ordinal: 4, quarterId: 'q2' },
    { id: 'may', label: 'May', ordinal: 5, quarterId: 'q2' },
    { id: 'jun', label: 'Jun', ordinal: 6, quarterId: 'q2' },
    { id: 'jul', label: 'Jul', ordinal: 7, quarterId: 'q3' },
    { id: 'aug', label: 'Aug', ordinal: 8, quarterId: 'q3' },
    { id: 'sep', label: 'Sep', ordinal: 9, quarterId: 'q3' },
    { id: 'oct', label: 'Oct', ordinal: 10, quarterId: 'q4' },
    { id: 'nov', label: 'Nov', ordinal: 11, quarterId: 'q4' },
    { id: 'dec', label: 'Dec', ordinal: 12, quarterId: 'q4' },
  ],
  days: [
    { id: 'mon', label: 'Mon', ordinal: 1, isWeekend: false },
    { id: 'tue', label: 'Tue', ordinal: 2, isWeekend: false },
    { id: 'wed', label: 'Wed', ordinal: 3, isWeekend: false },
    { id: 'thu', label: 'Thu', ordinal: 4, isWeekend: false },
    { id: 'fri', label: 'Fri', ordinal: 5, isWeekend: false },
    { id: 'sat', label: 'Sat', ordinal: 6, isWeekend: true },
    { id: 'sun', label: 'Sun', ordinal: 7, isWeekend: true },
  ],
};

export const calendarDimensionReferences: GalleryDataReference[] = [
  {
    kind: 'has-many',
    label: 'Chart Demo Data',
    targetSource: 'cart/app/gallery/data/chart-demo-data.ts',
    sourceField: 'months.id / quarters.id / days.id',
    targetField: 'months[] / quarters[] / days[]',
    summary:
      'This dimension table is the normalized source for the label arrays currently embedded in the chart demo document.',
  },
];
