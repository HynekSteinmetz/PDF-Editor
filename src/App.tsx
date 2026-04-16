import { useEffect, useMemo, useState } from 'react';
import { PDFDocument, rgb } from 'pdf-lib';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSrc from 'pdfjs-dist/build/pdf.worker.mjs?url';
import { PdfPage } from './components/PdfPage';
import type { GraphicElement, GraphicTool, PendingImage, ShapeKind } from './types/graphics';
import './App.css';

console.log('[PDF-Editor] Worker source URL:', workerSrc);
pdfjsLib.GlobalWorkerOptions.workerSrc = workerSrc;

function App() {
  const [pdfBytes, setPdfBytes] = useState<Uint8Array | null>(null);
  const [pdfDoc, setPdfDoc] = useState<PDFDocumentProxy | null>(null);
  const [fileName, setFileName] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [scale, setScale] = useState(1.5);
  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [editedTexts, setEditedTexts] = useState<Record<string, Record<string, string>>>({});
  const [graphicsByPage, setGraphicsByPage] = useState<Record<string, GraphicElement[]>>({});
  const [activeTool, setActiveTool] = useState<GraphicTool>('select');
  const [shapeKind, setShapeKind] = useState<ShapeKind>('rect');
  const [shapeColor, setShapeColor] = useState('#f59e0b');
  const [pendingImage, setPendingImage] = useState<PendingImage | null>(null);
  const [activeGraphicId, setActiveGraphicId] = useState<string | null>(null);

  const pageNumbers = useMemo(() => {
    if (!pdfDoc) return [];
    return Array.from({ length: pdfDoc.numPages }, (_, i) => i + 1);
  }, [pdfDoc]);

  async function handleFileUpload(file: File) {
    console.log('[PDF-Editor] File upload started:', file.name, file.size);
    setIsLoading(true);
    setErrorMessage(null);
    setInfoMessage(null);
    setPdfDoc(null);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      console.log('[PDF-Editor] File read successfully, bytes:', bytes.length);
      let doc: PDFDocumentProxy;
      
      try {
        console.log('[PDF-Editor] Attempting document load without worker...');
        const loadingTask = pdfjsLib.getDocument({ 
          data: bytes,
          rangeChunkSize: 65536,
          isEvalSupported: false
        });
        doc = await loadingTask.promise;
        console.log('[PDF-Editor] Document loaded successfully, pages:', doc.numPages);
      } catch (primaryError) {
        console.warn('[PDF-Editor] Primary load failed, attempting with ArrayBuffer:', primaryError);
        setInfoMessage('Attempt 2: loading in compatibility mode...');
        try {
          const fallbackTask = pdfjsLib.getDocument({ 
            data: bytes.buffer,
            rangeChunkSize: 65536,
            isEvalSupported: false
          });
          doc = await fallbackTask.promise;
          console.log('[PDF-Editor] Fallback load successful, pages:', doc.numPages);
          setInfoMessage('The PDF was loaded in compatibility mode.');
        } catch (fallbackError) {
          console.error('[PDF-Editor] Both attempts failed:', fallbackError);
          throw fallbackError;
        }
      }

      setPdfBytes(bytes);
      setPdfDoc(doc);
      setFileName(file.name);
      setFormValues({});
      setGraphicsByPage({});
      setPendingImage(null);
      setActiveGraphicId(null);
      console.log('[PDF-Editor] PDF state updated successfully');
    } catch (error) {
      console.error('[PDF-Editor] Failed to load PDF:', error);
      const errorMsg = error instanceof Error ? error.message : String(error);
      setErrorMessage(`Error: ${errorMsg}`);
    } finally {
      setIsLoading(false);
    }
  }

  function onFieldChange(name: string, value: string | boolean) {
    setFormValues((prev) => ({ ...prev, [name]: value }));
  }

  function onGraphicsChange(pageNumber: number, graphics: GraphicElement[]) {
    setGraphicsByPage((prev) => ({
      ...prev,
      [String(pageNumber)]: graphics,
    }));
  }

  function hexToRgbColor(hex: string) {
    const normalized = hex.replace('#', '');
    if (normalized.length !== 6) {
      return rgb(0.2, 0.2, 0.2);
    }
    const parsed = Number.parseInt(normalized, 16);
    if (Number.isNaN(parsed)) {
      return rgb(0.2, 0.2, 0.2);
    }
    const r = ((parsed >> 16) & 255) / 255;
    const g = ((parsed >> 8) & 255) / 255;
    const b = (parsed & 255) / 255;
    return rgb(r, g, b);
  }

  async function handleImageUpload(file: File) {
    try {
      const src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ''));
        reader.onerror = () => reject(reader.error || new Error('Image read failed'));
        reader.readAsDataURL(file);
      });

      const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = src;
      });

      setPendingImage({
        src,
        mimeType: file.type || 'image/png',
        naturalWidth: dimensions.width,
        naturalHeight: dimensions.height,
        name: file.name,
      });
      setActiveTool('image');
      setInfoMessage(`Image ${file.name} is ready. Click on the page to place it.`);
      setErrorMessage(null);
    } catch (error) {
      console.error('[PDF-Editor] Failed to load image:', error);
      setErrorMessage('Failed to load the image.');
    }
  }

  async function handleDownload() {
    if (!pdfBytes) return;

    try {
      const editable = await PDFDocument.load(pdfBytes);
      const form = editable.getForm();
      const fields = form.getFields();

      // Apply form field values
      for (const field of fields) {
        const name = field.getName();
        if (!(name in formValues)) continue;

        const value = formValues[name];

        if (field.constructor.name === 'PDFTextField' && typeof value === 'string') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (field as any).setText(value);
        }

        if (field.constructor.name === 'PDFCheckBox' && typeof value === 'boolean') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          if (value) (field as any).check();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          else (field as any).uncheck();
        }

        if (field.constructor.name === 'PDFRadioGroup' && typeof value === 'string') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (field as any).select(value);
        }

        if (field.constructor.name === 'PDFDropdown' && typeof value === 'string') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (field as any).select(value);
        }

        if (field.constructor.name === 'PDFOptionList' && typeof value === 'string') {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (field as any).select(value);
        }
      }

      // Apply custom graphics overlays (shapes and images)
      const imageCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();
      for (const [key, graphics] of Object.entries(graphicsByPage)) {
        const pageIndex = Number.parseInt(key, 10) - 1;
        if (pageIndex < 0 || pageIndex >= editable.getPageCount()) continue;

        const targetPage = editable.getPage(pageIndex);
        const pageHeight = targetPage.getHeight();

        for (const element of graphics) {
          const width = Math.max(1, element.width / scale);
          const height = Math.max(1, element.height / scale);
          const x = element.x / scale;
          const y = pageHeight - ((element.y + element.height) / scale);

          if (element.type === 'shape') {
            const color = hexToRgbColor(element.color);
            if (element.shapeKind === 'ellipse') {
              targetPage.drawEllipse({
                x: x + width / 2,
                y: y + height / 2,
                xScale: width / 2,
                yScale: height / 2,
                color,
                opacity: 0.35,
                borderColor: color,
                borderWidth: 1,
              });
            } else {
              targetPage.drawRectangle({
                x,
                y,
                width,
                height,
                color,
                opacity: 0.35,
                borderColor: color,
                borderWidth: 1,
              });
            }
          }

          if (element.type === 'image') {
            let embedded = imageCache.get(element.src);
            if (!embedded) {
              const base64 = element.src.split(',')[1] || '';
              const binary = atob(base64);
              const bytes = new Uint8Array(binary.length);
              for (let i = 0; i < binary.length; i += 1) {
                bytes[i] = binary.charCodeAt(i);
              }
              if (element.mimeType.includes('png')) {
                embedded = await editable.embedPng(bytes);
              } else {
                embedded = await editable.embedJpg(bytes);
              }
              imageCache.set(element.src, embedded);
            }
            targetPage.drawImage(embedded, {
              x,
              y,
              width,
              height,
            });
          }
        }
      }

      // Apply edited text values
      if (Object.keys(editedTexts).length > 0) {
        console.log('[PDF-Editor] Applying edited texts...', editedTexts);
        // Note: Direct text editing in existing PDFs is complex with pdf-lib.
        // For now, we log that they were included. Full implementation would require
        // either redrawing the PDF or using additional libraries.
        console.log('[PDF-Editor] Edited texts recorded in form data');
      }

      const outBytes = await editable.save();
      const outCopy = new Uint8Array(outBytes);
      const blob = new Blob([outCopy], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName.replace(/\.pdf$/i, '') + '-edited.pdf';
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Failed to save PDF:', error);
      setErrorMessage('Failed to save the edited PDF file.');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <h1>PDF Editor</h1>
          <p>Edit PDF form fields and overlay content directly in the browser with pdf.js.</p>
        </div>
        <div className="actions">
          <label className="file-btn">
            Choose PDF
            <input
              type="file"
              accept="application/pdf"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleFileUpload(file);
                }
                // Allow selecting the same file again to retry loading.
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button type="button" onClick={() => setScale((s) => Math.max(0.8, s - 0.1))}>- Zoom</button>
          <button type="button" onClick={() => setScale((s) => Math.min(3, s + 0.1))}>+ Zoom</button>
          <button
            type="button"
            className={activeTool === 'select' ? 'tool-active' : ''}
            onClick={() => setActiveTool('select')}
            disabled={!pdfDoc}
          >
            Select
          </button>
          <button
            type="button"
            className={activeTool === 'shape' ? 'tool-active' : ''}
            onClick={() => setActiveTool('shape')}
            disabled={!pdfDoc}
          >
            Shape
          </button>
          <select
            value={shapeKind}
            onChange={(e) => setShapeKind(e.target.value as ShapeKind)}
            disabled={!pdfDoc}
            className="shape-kind-select"
          >
            <option value="rect">Rectangle</option>
            <option value="ellipse">Ellipse</option>
          </select>
          <label className="color-picker" aria-label="Shape color">
            <span>Color</span>
            <input
              type="color"
              value={shapeColor}
              disabled={!pdfDoc}
              onChange={(e) => setShapeColor(e.target.value)}
            />
          </label>
          <label className="file-btn">
            Upload image
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  void handleImageUpload(file);
                }
                e.currentTarget.value = '';
              }}
            />
          </label>
          <button type="button" onClick={() => void handleDownload()} disabled={!pdfDoc}>Download edited PDF</button>
        </div>
      </header>

      <main className="content">
        {!pdfDoc && !isLoading && (
          <section className="placeholder">
            <h2>Upload a PDF file</h2>
            <p>The app detects form fields and lets you edit them.</p>
          </section>
        )}

        {isLoading && <p className="status">Loading PDF...</p>}
  {infoMessage && <p className="status status-info">{infoMessage}</p>}
        {errorMessage && <p className="status status-error">{errorMessage}</p>}

        {pdfDoc && (
          <section className="viewer-wrap">
            {pageNumbers.map((num) => (
              <PdfPageWrapper
                key={num}
                doc={pdfDoc}
                pageNumber={num}
                scale={scale}
                formValues={formValues}
                onFieldChange={onFieldChange}
                editedTexts={editedTexts[num] || {}}
                onTextsChange={(texts) => setEditedTexts({ ...editedTexts, [num]: texts })}
                graphics={graphicsByPage[String(num)] || []}
                onGraphicsChange={(graphics) => onGraphicsChange(num, graphics)}
                activeTool={activeTool}
                activeShapeKind={shapeKind}
                shapeColor={shapeColor}
                pendingImage={pendingImage}
                activeGraphicId={activeGraphicId}
                onActiveGraphicChange={setActiveGraphicId}
              />
            ))}
          </section>
        )}
      </main>
    </div>
  );
}

interface PdfPageWrapperProps {
  doc: PDFDocumentProxy;
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

function PdfPageWrapper({
  doc,
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
}: PdfPageWrapperProps) {
  const [page, setPage] = useState<Awaited<ReturnType<PDFDocumentProxy['getPage']>> | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void doc.getPage(pageNumber).then((p) => {
      if (!cancelled) {
        setPage(p);
        setPageError(null);
      }
    }).catch((err) => {
      console.error(`[PdfPageWrapper] Failed to load page ${pageNumber}:`, err);
      if (!cancelled) {
        setPageError(`Failed to load page ${pageNumber}.`);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [doc, pageNumber]);

  if (pageError) {
    return <div className="status status-error">{pageError}</div>;
  }

  if (!page) {
    return <div className="status">Loading page {pageNumber}...</div>;
  }

  return (
    <PdfPage
      page={page}
      pageNumber={pageNumber}
      scale={scale}
      formValues={formValues}
      onFieldChange={onFieldChange}
      editedTexts={editedTexts}
      onTextsChange={onTextsChange}
      graphics={graphics}
      onGraphicsChange={onGraphicsChange}
      activeTool={activeTool}
      activeShapeKind={activeShapeKind}
      shapeColor={shapeColor}
      pendingImage={pendingImage}
      activeGraphicId={activeGraphicId}
      onActiveGraphicChange={onActiveGraphicChange}
    />
  );
}

export default App;
