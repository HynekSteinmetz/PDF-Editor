export interface ExportableTextItem {
  id: string;
  rect: number[];
  content: string;
  sourceRects?: number[][];
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  fontSize?: number;
}