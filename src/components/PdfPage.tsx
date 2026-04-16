import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent as ReactMouseEvent } from 'react';
import type { PDFPageProxy, PageViewport } from 'pdfjs-dist';
import type { GraphicElement, GraphicTool, PendingImage, ShapeKind } from '../types/graphics';

// Annotation data shape returned by pdfjs-dist
interface AnnotationData {
  subtype: string;
  fieldType?: string;
  fieldName?: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fieldValue?: any;
  rect: number[];
  fieldFlags?: number;
  buttonValue?: string;
  checkBox?: boolean;
  radioButton?: boolean;
  options?: Array<{ exportValue: string; displayValue: string }>;
  multiLine?: boolean;
  readOnly?: boolean;
}

// Shared text item interface for both form fields and extracted text
interface TextItem {
  id: string;
  type: 'text' | 'field';
  fieldName?: string;
  fieldType?: string;
  fieldValue?: string;
  fieldFlags?: number;
  rect: number[];
  content: string;
  isReadOnly?: boolean;
  options?: Array<{ exportValue: string; displayValue: string }>;
  checkBox?: boolean;
  radioButton?: boolean;
  buttonValue?: string;
  multiLine?: boolean;
  fontFamily?: string;
  fontWeight?: CSSProperties['fontWeight'];
  fontStyle?: CSSProperties['fontStyle'];
  fontSize?: number;
}

interface PdfPageProps {
  page: PDFPageProxy;
  pageNumber: number;
  scale: number;
  formValues: Record<string, string | boolean>;
  onFieldChange: (name: string, value: string | boolean) => void;
  editedTexts: Record<string, string>;
  onTextsChange: (texts: Record<string, string>) => void;
  graphics: GraphicElement[];
  onGraphicsChange: (graphics: GraphicElement[]) => void;
  activeTool: GraphicTool;
  activeShapeKind: ShapeKind;
  shapeColor: string;
  pendingImage: PendingImage | null;
  activeGraphicId: string | null;
  onActiveGraphicChange: (id: string | null) => void;
}

// Bit flags from PDF spec
const FLAG_READONLY = 1;
const FLAG_MULTILINE = 0x1000;
const FLAG_RADIO = 0x8000;
const FLAG_PUSHBUTTON = 0x10000;

export function PdfPage({
  page,
  pageNumber,
  scale,
  formValues,
  onFieldChange,
  editedTexts,
  onTextsChange,
  graphics,
  onGraphicsChange,
  activeTool,
  activeShapeKind,
  shapeColor,
  pendingImage,
  activeGraphicId,
  onActiveGraphicChange,
}: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [textItems, setTextItems] = useState<TextItem[]>([]);
  const [viewport, setViewport] = useState<PageViewport | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [activeTextId, setActiveTextId] = useState<string | null>(null);
  const renderTaskRef = useRef<Awaited<ReturnType<typeof page.render>> | null>(null);
  const dragRef = useRef<{
    id: string;
    mode: 'move' | 'resize';
    startX: number;
    startY: number;
    startLeft: number;
    startTop: number;
    startWidth: number;
    startHeight: number;
  } | null>(null);

  // Render page canvas and load text + annotations
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    console.log('[PdfPage] Rendering page', pageNumber, 'with scale', scale);
    let isMounted = true;

    const renderPage = async () => {
      try {
        // Cancel previous render if it's still running
        if (renderTaskRef.current) {
          console.log('[PdfPage] Cancelling previous render...');
          renderTaskRef.current.cancel();
        }

        const vp = page.getViewport({ scale });
        if (!isMounted) return;
        
        setViewport(vp);
        canvas.width = vp.width;
        canvas.height = vp.height;
        canvas.style.width = `${vp.width}px`;
        canvas.style.height = `${vp.height}px`;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          throw new Error('Could not get canvas 2D context');
        }

        console.log('[PdfPage] Starting page render...');
        const renderTask = page.render({ canvasContext: ctx, viewport: vp, canvas });
        renderTaskRef.current = renderTask;

        await renderTask.promise;
        if (!isMounted) return;
        
        console.log('[PdfPage] Page', pageNumber, 'rendered successfully');
        setRenderError(null);
      } catch (err) {
        // Ignore cancellation errors
        if (err instanceof Error && err.name === 'RenderingCancelledException') {
          console.log('[PdfPage] Previous render was cancelled');
          return;
        }
        console.error('[PdfPage] Render error on page', pageNumber, ':', err);
        if (isMounted) {
          setRenderError(`Render error: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    };

    const loadContent = async () => {
      try {
        const items: TextItem[] = [];
        let itemId = 0;
        const fieldRects: number[][] = [];

        const intersects = (a: number[], b: number[]) => {
          const [ax1, ay1, ax2, ay2] = a;
          const [bx1, by1, bx2, by2] = b;
          const left = Math.max(Math.min(ax1, ax2), Math.min(bx1, bx2));
          const right = Math.min(Math.max(ax1, ax2), Math.max(bx1, bx2));
          const bottom = Math.max(Math.min(ay1, ay2), Math.min(by1, by2));
          const top = Math.min(Math.max(ay1, ay2), Math.max(by1, by2));
          return right > left && top > bottom;
        };

        // Load form fields (annotations)
        try {
          const annots = await page.getAnnotations({ intent: 'display' });
          const widgets = (annots as AnnotationData[]).filter(
            (a) => a.subtype === 'Widget' && a.fieldName
          );
          console.log('[PdfPage] Found', widgets.length, 'form fields on page', pageNumber);

          widgets.forEach((annotation) => {
            const flags = annotation.fieldFlags || 0;
            fieldRects.push(annotation.rect);
            items.push({
              id: `field_${annotation.fieldName}`,
              type: 'field',
              fieldName: annotation.fieldName,
              fieldType: annotation.fieldType,
              fieldValue: annotation.fieldValue,
              fieldFlags: flags,
              rect: annotation.rect,
              content: String(annotation.fieldValue || ''),
              isReadOnly: !!(flags & FLAG_READONLY) || !!annotation.readOnly,
              checkBox: annotation.checkBox,
              radioButton: annotation.radioButton,
              buttonValue: annotation.buttonValue,
              multiLine: !!(flags & FLAG_MULTILINE) || !!annotation.multiLine,
              options: annotation.options,
            });
          });
        } catch (err) {
          console.error('[PdfPage] Annotation load error on page', pageNumber, ':', err);
        }

        // Load text content
        try {
          const textContent = await page.getTextContent();
          const textContentWithStyles = textContent as typeof textContent & {
            styles?: Record<string, { fontFamily?: string }>;
          };
          const extractedTokens: Array<{
            text: string;
            rect: number[];
            fontName?: string;
            height: number;
            width: number;
            centerY: number;
            fontSize: number;
          }> = [];
          const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();
          const pickFontFamily = (fontName?: string) => {
            if (!fontName) return 'inherit';
            const styleInfo = textContentWithStyles.styles?.[fontName];
            if (styleInfo?.fontFamily) {
              return styleInfo.fontFamily;
            }
            const n = fontName.toLowerCase();
            if (n.includes('times') || n.includes('serif')) return 'Times New Roman, serif';
            if (n.includes('courier') || n.includes('mono')) return 'Courier New, monospace';
            if (n.includes('helvetica') || n.includes('arial') || n.includes('sans')) {
              return 'Arial, Helvetica, sans-serif';
            }
            return 'inherit';
          };
          const pickFontWeight = (fontName?: string): CSSProperties['fontWeight'] => {
            if (!fontName) return 'normal';
            return /bold|black|heavy/i.test(fontName) ? 700 : 'normal';
          };
          const pickFontStyle = (fontName?: string): CSSProperties['fontStyle'] => {
            if (!fontName) return 'normal';
            return /italic|oblique/i.test(fontName) ? 'italic' : 'normal';
          };
          const rectArea = (rect: number[]) => Math.abs((rect[2] - rect[0]) * (rect[3] - rect[1]));
          const overlapRatio = (a: number[], b: number[]) => {
            const left = Math.max(Math.min(a[0], a[2]), Math.min(b[0], b[2]));
            const right = Math.min(Math.max(a[0], a[2]), Math.max(b[0], b[2]));
            const bottom = Math.max(Math.min(a[1], a[3]), Math.min(b[1], b[3]));
            const top = Math.min(Math.max(a[1], a[3]), Math.max(b[1], b[3]));
            const intersection = Math.max(0, right - left) * Math.max(0, top - bottom);
            if (intersection <= 0) return 0;
            const minArea = Math.max(1, Math.min(rectArea(a), rectArea(b)));
            return intersection / minArea;
          };

          textContent.items.forEach((item: unknown) => {
            const textItem = item as {
              str?: string;
              width?: number;
              height?: number;
              x?: number;
              y?: number;
              transform?: number[];
              fontName?: string;
            };
            if (textItem.str && textItem.str.trim() && textItem.transform) {
              const x = textItem.transform[4] || 0;
              const y = textItem.transform[5] || 0;
              const height = textItem.height || Math.abs(textItem.transform[3] || 0) || 12;
              const width = textItem.width || textItem.str.length * 6;
              const fontSize = Math.max(
                1,
                Math.abs(textItem.transform[3] || 0),
                Math.abs(textItem.transform[0] || 0),
                height,
              );
              const tokenRect: number[] = [x, y, x + width, y + height];

              extractedTokens.push({
                text: textItem.str,
                rect: tokenRect,
                fontName: textItem.fontName,
                height,
                width,
                centerY: y + height * 0.5,
                fontSize,
              });
            }
          });

          const lines: Array<{
            tokens: typeof extractedTokens;
            centerY: number;
            avgHeight: number;
          }> = [];

          const sortedTokens = [...extractedTokens].sort((left, right) => {
            const verticalDelta = right.centerY - left.centerY;
            if (Math.abs(verticalDelta) > 2) {
              return verticalDelta;
            }
            return left.rect[0] - right.rect[0];
          });

          for (const token of sortedTokens) {
            const targetLine = lines.find((line) => {
              const tolerance = Math.max(3, Math.min(12, Math.max(line.avgHeight, token.height) * 0.45));
              return Math.abs(line.centerY - token.centerY) <= tolerance;
            });

            if (!targetLine) {
              lines.push({
                tokens: [token],
                centerY: token.centerY,
                avgHeight: token.height,
              });
              continue;
            }

            targetLine.tokens.push(token);
            targetLine.centerY =
              (targetLine.centerY * (targetLine.tokens.length - 1) + token.centerY) / targetLine.tokens.length;
            targetLine.avgHeight =
              (targetLine.avgHeight * (targetLine.tokens.length - 1) + token.height) / targetLine.tokens.length;
          }

          const rawTextItems: Array<{
            rect: number[];
            content: string;
            fontFamily: string;
            fontWeight: CSSProperties['fontWeight'];
            fontStyle: CSSProperties['fontStyle'];
            fontSize: number;
          }> = [];
          for (const line of lines) {
            const tokens = [...line.tokens].sort((left, right) => left.rect[0] - right.rect[0]);
            let currentSegment: {
              text: string;
              rect: number[];
              fontName?: string;
              avgCharWidth: number;
              avgFontSize: number;
              tokenCount: number;
            } | null = null;

            const flushSegment = () => {
              if (!currentSegment) return;
              const content = normalizeText(currentSegment.text);
              if (!content) {
                currentSegment = null;
                return;
              }
              const overlapsField = fieldRects.some((rect) => intersects(currentSegment!.rect, rect));
              if (!overlapsField) {
                rawTextItems.push({
                  rect: currentSegment.rect,
                  content,
                  fontFamily: pickFontFamily(currentSegment.fontName),
                  fontWeight: pickFontWeight(currentSegment.fontName),
                  fontStyle: pickFontStyle(currentSegment.fontName),
                  fontSize: currentSegment.avgFontSize,
                });
              }
              currentSegment = null;
            };

            for (const token of tokens) {
              const charWidth = token.width / Math.max(1, token.text.length);

              if (!currentSegment) {
                currentSegment = {
                  text: token.text,
                  rect: [...token.rect],
                  fontName: token.fontName,
                  avgCharWidth: charWidth,
                  avgFontSize: token.fontSize,
                  tokenCount: 1,
                };
                continue;
              }

              const gap = token.rect[0] - currentSegment.rect[2];
              const gapThreshold = Math.max(8, currentSegment.avgCharWidth * 2.5, token.height * 0.5);
              const shouldSplit = gap > gapThreshold;

              if (shouldSplit) {
                flushSegment();
                currentSegment = {
                  text: token.text,
                  rect: [...token.rect],
                  fontName: token.fontName,
                  avgCharWidth: charWidth,
                  avgFontSize: token.fontSize,
                  tokenCount: 1,
                };
                continue;
              }

              const needsSpace = gap > Math.max(1, currentSegment.avgCharWidth * 0.15);
              currentSegment.text += `${needsSpace ? ' ' : ''}${token.text}`;
              currentSegment.rect = [
                Math.min(currentSegment.rect[0], token.rect[0]),
                Math.min(currentSegment.rect[1], token.rect[1]),
                Math.max(currentSegment.rect[2], token.rect[2]),
                Math.max(currentSegment.rect[3], token.rect[3]),
              ];
              currentSegment.fontName ||= token.fontName;
              currentSegment.avgCharWidth =
                (currentSegment.avgCharWidth * currentSegment.tokenCount + charWidth) /
                (currentSegment.tokenCount + 1);
              currentSegment.avgFontSize =
                (currentSegment.avgFontSize * currentSegment.tokenCount + token.fontSize) /
                (currentSegment.tokenCount + 1);
              currentSegment.tokenCount += 1;
            }

            flushSegment();
          }

          const dedupedTextItems: Array<{
            rect: number[];
            content: string;
            fontFamily: string;
            fontWeight: CSSProperties['fontWeight'];
            fontStyle: CSSProperties['fontStyle'];
            fontSize: number;
          }> = [];
          for (const candidate of rawTextItems) {
            const isDuplicate = dedupedTextItems.some((existing) => {
              const sameText = existing.content === candidate.content;
              const almostSameBox = overlapRatio(existing.rect, candidate.rect) > 0.75;
              return sameText && almostSameBox;
            });
            if (!isDuplicate) {
              dedupedTextItems.push(candidate);
            }
          }

          for (const entry of dedupedTextItems) {
            items.push({
              id: `text_${itemId++}`,
              type: 'text',
              rect: entry.rect,
              content: entry.content,
              isReadOnly: false,
              fontFamily: entry.fontFamily,
              fontWeight: entry.fontWeight,
              fontStyle: entry.fontStyle,
              fontSize: entry.fontSize,
            });
          }

          console.log('[PdfPage] Found', items.length, 'editable items total');
        } catch (err) {
          console.error('[PdfPage] Text extraction error on page', pageNumber, ':', err);
        }

        if (isMounted) {
          setTextItems(items);
        }
      } catch (err) {
        console.error('[PdfPage] Content load error:', err);
      }
    };

    void renderPage();
    void loadContent();

    return () => {
      isMounted = false;
      // Cancel render task on cleanup
      if (renderTaskRef.current) {
        console.log('[PdfPage] Cleanup: cancelling render task');
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }
    };
  }, [page, pageNumber, scale]);

  // Convert PDF rect [x1,y1,x2,y2] to CSS position on the canvas overlay
  function rectToStyle(rect: number[]): CSSProperties {
    if (!viewport) return {};
    const [vx1, vy1, vx2, vy2] = viewport.convertToViewportRectangle(rect);
    const left = Math.min(vx1, vx2);
    const top = Math.min(vy1, vy2);
    const width = Math.abs(vx2 - vx1);
    const height = Math.abs(vy2 - vy1);
    return { position: 'absolute', left, top, width, height };
  }

  function clampGraphic(element: GraphicElement): GraphicElement {
    if (!viewport) return element;
    const minSize = 24;
    const width = Math.max(minSize, Math.min(element.width, viewport.width));
    const height = Math.max(minSize, Math.min(element.height, viewport.height));
    const x = Math.max(0, Math.min(element.x, viewport.width - width));
    const y = Math.max(0, Math.min(element.y, viewport.height - height));
    return { ...element, x, y, width, height };
  }

  function updateGraphic(id: string, updater: (element: GraphicElement) => GraphicElement) {
    onGraphicsChange(
      graphics.map((element) => (element.id === id ? clampGraphic(updater(element)) : element))
    );
  }

  function onPageClick(event: ReactMouseEvent<HTMLDivElement>) {
    if (!viewport) return;
    if (event.target !== event.currentTarget) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    if (activeTool === 'shape') {
      const newShape: GraphicElement = clampGraphic({
        id: `shape_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        type: 'shape',
        shapeKind: activeShapeKind,
        color: shapeColor,
        x: x - 70,
        y: y - 45,
        width: 140,
        height: 90,
      });
      onGraphicsChange([...graphics, newShape]);
      onActiveGraphicChange(newShape.id);
      return;
    }

    if (activeTool === 'image' && pendingImage) {
      const ratio = Math.max(0.1, pendingImage.naturalWidth / Math.max(1, pendingImage.naturalHeight));
      const startWidth = Math.min(220, viewport.width * 0.35);
      const startHeight = Math.max(40, startWidth / ratio);
      const newImage: GraphicElement = clampGraphic({
        id: `image_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`,
        type: 'image',
        src: pendingImage.src,
        mimeType: pendingImage.mimeType,
        x: x - startWidth / 2,
        y: y - startHeight / 2,
        width: startWidth,
        height: startHeight,
      });
      onGraphicsChange([...graphics, newImage]);
      onActiveGraphicChange(newImage.id);
      return;
    }

    if (activeTool === 'select') {
      onActiveGraphicChange(null);
    }
  }

  function onGraphicMouseDown(event: ReactMouseEvent<HTMLDivElement>, id: string, mode: 'move' | 'resize') {
    if (activeTool !== 'select') return;
    const current = graphics.find((item) => item.id === id);
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    onActiveGraphicChange(id);

    dragRef.current = {
      id,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      startLeft: current.x,
      startTop: current.y,
      startWidth: current.width,
      startHeight: current.height,
    };

    const onMove = (moveEvent: MouseEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const deltaX = moveEvent.clientX - drag.startX;
      const deltaY = moveEvent.clientY - drag.startY;
      updateGraphic(drag.id, (element) => {
        if (drag.mode === 'move') {
          return {
            ...element,
            x: drag.startLeft + deltaX,
            y: drag.startTop + deltaY,
          };
        }
        return {
          ...element,
          width: drag.startWidth + deltaX,
          height: drag.startHeight + deltaY,
        };
      });
    };

    const onUp = () => {
      dragRef.current = null;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function removeGraphic(id: string) {
    onGraphicsChange(graphics.filter((item) => item.id !== id));
    if (activeGraphicId === id) {
      onActiveGraphicChange(null);
    }
  }

  function renderField(item: TextItem, index: number) {
    if (item.type === 'text') {
      // Render editable text
      const posStyle = rectToStyle(item.rect);
      const value = editedTexts[item.id] !== undefined ? editedTexts[item.id] : item.content;
      const hasUserEdit = editedTexts[item.id] !== undefined && editedTexts[item.id] !== item.content;
      const isActive = activeTextId === item.id;
      const fontSize = item.fontSize ? Math.max(8, item.fontSize * scale) : Math.max(8, (posStyle.height as number) * 0.82);

      if (!isActive && !hasUserEdit) {
        return (
          <button
            key={item.id}
            type="button"
            aria-label="Edit text"
            title="Click to edit text"
            style={{
              ...posStyle,
              boxSizing: 'border-box',
              background: 'transparent',
              border: '1px dashed rgba(80, 130, 190, 0.28)',
              padding: 0,
              cursor: 'text',
              zIndex: 2,
            }}
            onClick={() => setActiveTextId(item.id)}
          />
        );
      }

      return (
        <input
          key={item.id}
          type="text"
          style={{
            ...posStyle,
            boxSizing: 'border-box',
            background: '#f7fbff',
            border: '1px solid rgba(80, 130, 190, 0.35)',
            padding: 0,
            color: '#11253b',
            fontSize: `${fontSize}px`,
            fontFamily: item.fontFamily || 'inherit',
            fontWeight: item.fontWeight || 'normal',
            fontStyle: item.fontStyle || 'normal',
            lineHeight: 1,
            borderRadius: 0,
            letterSpacing: '0px',
            zIndex: 2,
          }}
          value={value}
          autoFocus={isActive}
          onChange={(e) => onTextsChange({ ...editedTexts, [item.id]: e.target.value })}
          onBlur={() => setActiveTextId(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === 'Escape') {
              setActiveTextId(null);
            }
          }}
          placeholder={item.content}
        />
      );
    }

    // Form field rendering
    const fieldName = item.fieldName;
    if (!fieldName) return null;

    const isReadOnly = !!item.isReadOnly;
    const posStyle = rectToStyle(item.rect);

    if (item.fieldType === 'Tx') {
      const isMultiLine = !!item.multiLine;
      const value = fieldName in formValues
        ? (formValues[fieldName] as string)
        : (typeof item.fieldValue === 'string' ? item.fieldValue : '');

      const commonStyle: CSSProperties = {
        ...posStyle,
        boxSizing: 'border-box',
        background: 'rgba(255, 255, 160, 0.5)',
        border: '1px solid rgba(0,0,200,0.3)',
        padding: '1px 2px',
        fontSize: `${Math.max(8, (posStyle.height as number) * 0.65)}px`,
        fontFamily: 'inherit',
        zIndex: 2,
      };

      if (isMultiLine) {
        return (
          <textarea
            key={`${fieldName}_${index}`}
            style={{ ...commonStyle, resize: 'none' }}
            value={value}
            readOnly={isReadOnly}
            onChange={(e) => !isReadOnly && onFieldChange(fieldName, e.target.value)}
          />
        );
      }
      return (
        <input
          key={`${fieldName}_${index}`}
          type="text"
          style={commonStyle}
          value={value}
          readOnly={isReadOnly}
          onChange={(e) => !isReadOnly && onFieldChange(fieldName, e.target.value)}
        />
      );
    }

    if (item.fieldType === 'Btn') {
      // Skip push buttons
      const flags = item.fieldFlags || 0;
      if (flags & FLAG_PUSHBUTTON) return null;

      if (item.checkBox) {
        const checked = fieldName in formValues
          ? (formValues[fieldName] as boolean)
          : (item.fieldValue === 'On' || item.fieldValue === 'Yes');

        return (
          <input
            key={`${fieldName}_${index}`}
            type="checkbox"
            style={{ ...posStyle, cursor: isReadOnly ? 'default' : 'pointer', accentColor: '#0066cc', zIndex: 2 }}
            checked={checked}
            readOnly={isReadOnly}
            onChange={(e) => !isReadOnly && onFieldChange(fieldName, e.target.checked)}
          />
        );
      }

      if (item.radioButton || (item.fieldFlags && item.fieldFlags & FLAG_RADIO)) {
        const groupValue = fieldName in formValues
          ? (formValues[fieldName] as string)
          : (typeof item.fieldValue === 'string' ? item.fieldValue : '');
        const checked = groupValue === item.buttonValue;

        return (
          <input
            key={`${fieldName}_${item.buttonValue}_${index}`}
            type="radio"
            style={{ ...posStyle, cursor: isReadOnly ? 'default' : 'pointer', accentColor: '#0066cc', zIndex: 2 }}
            checked={checked}
            readOnly={isReadOnly}
            onChange={() => !isReadOnly && onFieldChange(fieldName, item.buttonValue ?? '')}
          />
        );
      }
    }

    if (item.fieldType === 'Ch') {
      const rawValue = Array.isArray(item.fieldValue)
        ? item.fieldValue[0]
        : item.fieldValue;
      const value = fieldName in formValues
        ? (formValues[fieldName] as string)
        : (typeof rawValue === 'string' ? rawValue : '');

      return (
        <select
          key={`${fieldName}_${index}`}
          style={{
            ...posStyle,
            boxSizing: 'border-box',
            background: 'rgba(255, 255, 160, 0.5)',
            border: '1px solid rgba(0,0,200,0.3)',
            fontSize: `${Math.max(8, (posStyle.height as number) * 0.65)}px`,
            zIndex: 2,
          }}
          value={value}
          disabled={isReadOnly}
          onChange={(e) => !isReadOnly && onFieldChange(fieldName, e.target.value)}
        >
          <option value="">--</option>
          {item.options?.map(({ exportValue, displayValue }) => (
            <option key={exportValue} value={exportValue}>{displayValue}</option>
          ))}
        </select>
      );
    }

    return null;
  }

  return (
    <div className="pdf-page">
      <div className="page-label">Page {pageNumber}</div>
      {renderError && <div className="status status-error">{renderError}</div>}
      <div
        className="page-canvas-container"
        style={{ position: 'relative', display: 'inline-block' }}
      >
        <canvas ref={canvasRef} />
        {viewport && textItems.map((item, i) => renderField(item, i))}
        {viewport && (
          <div
            className={`graphics-layer tool-${activeTool}`}
            style={{
              position: 'absolute',
              inset: 0,
              cursor: activeTool === 'select' ? 'default' : 'crosshair',
              pointerEvents: activeTool === 'select' ? 'none' : 'auto',
            }}
            onClick={activeTool === 'select' ? undefined : onPageClick}
          >
            {graphics.map((element) => {
              const isActive = activeGraphicId === element.id;
              const baseStyle: CSSProperties = {
                position: 'absolute',
                left: element.x,
                top: element.y,
                width: element.width,
                height: element.height,
                border: isActive ? '2px solid #0f766e' : '1px solid rgba(15, 118, 110, 0.45)',
                boxSizing: 'border-box',
                cursor: activeTool === 'select' ? 'move' : 'default',
                pointerEvents: activeTool === 'select' ? 'auto' : 'none',
              };

              if (element.type === 'shape') {
                return (
                  <div
                    key={element.id}
                    style={{
                      ...baseStyle,
                      background: `${element.color}66`,
                      borderRadius: element.shapeKind === 'ellipse' ? '50%' : '6px',
                    }}
                    onMouseDown={(event) => onGraphicMouseDown(event, element.id, 'move')}
                  >
                    {isActive && activeTool === 'select' && (
                      <>
                        <button
                          type="button"
                          className="graphic-delete-btn"
                          onClick={(event) => {
                            event.stopPropagation();
                            removeGraphic(element.id);
                          }}
                        >
                          x
                        </button>
                        <div
                          className="graphic-resize-handle"
                          onMouseDown={(event) => onGraphicMouseDown(event, element.id, 'resize')}
                        />
                      </>
                    )}
                  </div>
                );
              }

              return (
                <div
                  key={element.id}
                  style={{ ...baseStyle, overflow: 'hidden', borderRadius: '6px', background: '#fff' }}
                  onMouseDown={(event) => onGraphicMouseDown(event, element.id, 'move')}
                >
                  <img
                    src={element.src}
                    alt="Inserted"
                    draggable={false}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', pointerEvents: 'none' }}
                  />
                  {isActive && activeTool === 'select' && (
                    <>
                      <button
                        type="button"
                        className="graphic-delete-btn"
                        onClick={(event) => {
                          event.stopPropagation();
                          removeGraphic(element.id);
                        }}
                      >
                        x
                      </button>
                      <div
                        className="graphic-resize-handle"
                        onMouseDown={(event) => onGraphicMouseDown(event, element.id, 'resize')}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
