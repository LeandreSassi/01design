import * as pdfjsLib from './PDF.js/build/pdf.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'PDF.js/build/pdf.worker.mjs';

function renderPDF(pdfPath, containerId) {
  // ... existing renderPDF function ...
}

const pdfPath = 'PDF.js/build/Portfolio_LeandreSassi_2024.pdf';
renderPDF(pdfPath, 'pdf-container');
