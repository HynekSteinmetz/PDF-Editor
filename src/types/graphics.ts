export type GraphicTool = 'select' | 'shape' | 'image';

export type ShapeKind = 'rect' | 'ellipse';

interface GraphicBase {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ShapeGraphic extends GraphicBase {
  type: 'shape';
  shapeKind: ShapeKind;
  color: string;
}

export interface ImageGraphic extends GraphicBase {
  type: 'image';
  src: string;
  mimeType: string;
}

export type GraphicElement = ShapeGraphic | ImageGraphic;

export interface PendingImage {
  src: string;
  mimeType: string;
  naturalWidth: number;
  naturalHeight: number;
  name: string;
}
