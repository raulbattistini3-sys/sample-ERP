// CSV for Excel/LibreOffice in pt-BR: ";" separates columns because "," is the decimal separator,
// and the UTF-8 BOM makes Excel show accents correctly
const SEPARATOR = ";";
const BOM = "﻿";

const escapeField = (value: string) =>
  /[";\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const toCsv = (rows: (string | number)[][]) =>
  BOM + rows.map((row) => row.map((field) => escapeField(String(field))).join(SEPARATOR)).join("\r\n");

// plain number with a decimal comma (no thousands separator), which spreadsheets read as a number
export const csvNumber = (value: number, decimals = 2) => value.toFixed(decimals).replace(".", ",");

export const downloadTextFile = (fileName: string, content: string, mimeType = "text/csv;charset=utf-8") => {
  const url = URL.createObjectURL(new Blob([content], { type: mimeType }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // give the browser a moment to start the download before releasing the blob
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
