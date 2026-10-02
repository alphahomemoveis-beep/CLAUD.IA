import type { Metadata } from "next";
import { InstagramWidget } from "@/components/InstagramWidget";

export const metadata: Metadata = { title: "Instagram ao vivo · AlphaHome" };

/** Widget em tela própria: dá para fixar no celular ("Adicionar à tela inicial") ou deixar aberto numa TV. */
export default function WidgetPage() {
  return (
    <div className="widget-page">
      <InstagramWidget />
      <p className="tiny muted" style={{ textAlign: "center", marginTop: 12 }}>
        Atualiza sozinho a cada 3 horas. No celular, use “Adicionar à tela inicial” para ter o widget à mão.
      </p>
    </div>
  );
}
