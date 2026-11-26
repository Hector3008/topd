import { reducirDimensiones } from "./logica.js";

// Reduce la foto en el teléfono (lado mayor 1600 px, JPEG): se ve igual y viaja en una fracción del peso.
export async function fotoReducida(archivo) {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("imagen")); i.src = url; });
    const { ancho, alto } = reducirDimensiones(img.naturalWidth, img.naturalHeight);
    const lienzo = document.createElement("canvas");
    lienzo.width = ancho; lienzo.height = alto;
    lienzo.getContext("2d").drawImage(img, 0, 0, ancho, alto);
    return lienzo.toDataURL("image/jpeg", 0.85);
  } finally {
    URL.revokeObjectURL(url);
  }
}
