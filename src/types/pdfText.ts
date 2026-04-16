export interface ExportableTextItem {
  id: string;
  rect: number[];
  content: string;
  fontFamily?: string;
  fontWeight?: string | number;
  fontStyle?: string;
  fontSize?: number;
}