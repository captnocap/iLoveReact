import { defineGalleryDataStory, defineGallerySection } from '../types';
import { modelRouteMockData, modelRouteReferences, modelRouteSchema } from '../data/core/model-route';

export const modelRouteSection = defineGallerySection({
  id: "model-route",
  title: "Model Route",
  group: {
    id: "data-shapes",
    title: "Data Shapes",
  },
  kind: 'atom',
  stories: [
    defineGalleryDataStory({
      id: "model-route/catalog",
      title: "Model Route",
      source: "cart/app/gallery/data/model-route.ts",
      format: 'data',
      status: 'draft',
      tags: ["data"],
      storage: ["sqlite-document"],
      references: modelRouteReferences,
      schema: modelRouteSchema,
      mockData: modelRouteMockData,
    }),
  ],
});
