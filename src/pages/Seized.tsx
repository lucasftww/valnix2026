import { Copy, Check } from "lucide-react";
import { useState } from "react";
import brazilFlag from "@/assets/brazil-flag.png";
import policiaFederal from "@/assets/policia-federal.webp";
import policiaCivilPR from "@/assets/policia-civil-pr.webp";
import policiaCivilSC from "@/assets/policia-civil-sc.webp";

const Seized = () => {
  const [copied, setCopied] = useState(false);

  const pageText = `LABORATÓRIO DE OPERAÇÕES CIBERNÉTICAS/CGCCO

OPERAÇÃO "FRAUDE"

PÁGINA BLOQUEADA

O domínio acessado foi bloqueado em decorrência da "Operação FRAUDE", ação integrada, com o intuito de reprimir estelionato e golpes virtuais praticados pelo detentor da página solicitada. No Brasil, a operação integrada contou com a participação das polícias judiciárias de 02 estados (SC, PR) e da Secretaria de Operações Integradas, por meio do Laboratório de Operações Cibernéticas/CGCCO/DIOP/SEOPI/MJSP.`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(pageText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div 
      className="min-h-screen bg-white flex flex-col items-center justify-center px-4 py-6 cursor-pointer group relative overflow-hidden"
      onClick={handleCopy}
      title="Clique para copiar o texto"
    >
      {/* Copy indicator - hidden on mobile */}
      <div className="fixed top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity duration-300 items-center gap-2 bg-gray-100 px-3 py-2 rounded-lg shadow-md z-10 hidden md:flex">
        {copied ? (
          <>
            <Check className="w-4 h-4 text-green-600" />
            <span className="text-sm text-green-600 font-medium">Copiado!</span>
          </>
        ) : (
          <>
            <Copy className="w-4 h-4 text-gray-600" />
            <span className="text-sm text-gray-600">Clique para copiar</span>
          </>
        )}
      </div>

      {/* Brazilian Flag */}
      <div className="mb-4">
        <img src={brazilFlag} alt="Bandeira do Brasil" className="w-24 md:w-28 h-auto" />
      </div>

      {/* Header */}
      <h1 className="text-gray-800 text-sm md:text-base font-semibold tracking-wide mb-1 text-center">
        LABORATÓRIO DE OPERAÇÕES CIBERNÉTICAS/CGCCO
      </h1>
      
      <h2 className="text-gray-900 text-xl md:text-2xl font-bold mb-3 text-center">
        OPERAÇÃO "FRAUDE"
      </h2>

      {/* Blocked Banner */}
      <div className="bg-[#F5A623] px-6 py-2 mb-4">
        <h3 className="text-white text-xl md:text-3xl font-bold tracking-wider">
          PÁGINA BLOQUEADA
        </h3>
      </div>

      {/* Description */}
      <div className="max-w-2xl text-center mb-6 px-4">
        <p className="text-gray-700 text-xs md:text-sm leading-relaxed">
          O domínio acessado foi bloqueado em decorrência da "Operação FRAUDE", ação integrada, com o intuito de reprimir estelionato e golpes virtuais praticados pelo detentor da página solicitada. No Brasil, a operação integrada contou com a participação das polícias judiciárias de 02 estados (SC, PR) e da Secretaria de Operações Integradas, por meio do Laboratório de Operações Cibernéticas/CGCCO/DIOP/SEOPI/MJSP.
        </p>
      </div>

      {/* Police Badges Row */}
      <div className="flex flex-wrap justify-center items-center gap-4 md:gap-8 mb-6">
        <img src={policiaFederal} alt="Polícia Federal" className="w-16 h-auto md:w-24" />
        <img src={policiaCivilSC} alt="Polícia Civil SC" className="w-16 h-auto md:w-24" />
        <img src={policiaCivilPR} alt="Polícia Civil PR" className="w-16 h-auto md:w-24" />
      </div>

      {/* Government Logos */}
      <div className="flex flex-wrap justify-center items-center gap-4 md:gap-6 border-t border-gray-200 pt-4 w-full max-w-3xl">
        {/* MJSP Logo */}
        <div className="flex items-center gap-2 bg-[#1351B4] px-3 py-2 rounded">
          <span className="text-white text-[8px] md:text-[10px] font-bold leading-tight text-center">
            MINISTÉRIO DA JUSTIÇA<br/>E SEGURANÇA PÚBLICA
          </span>
        </div>

        {/* Gov.br Logo */}
        <div className="flex items-center">
          <span className="text-[#1351B4] text-lg md:text-xl font-bold">gov</span>
          <span className="text-[#FEDD00] text-lg md:text-xl font-bold">.br</span>
        </div>

        {/* SEOPI Logo */}
        <div className="bg-[#0D2240] px-3 py-2 rounded">
          <span className="text-white text-[10px] md:text-xs font-bold">SEOPI</span>
        </div>

        {/* CGCCO Logo */}
        <div className="bg-[#1E3A5F] px-3 py-2 rounded">
          <span className="text-white text-[10px] md:text-xs font-bold">CGCCO</span>
        </div>
      </div>

      {/* Footer text */}
      <div className="mt-4 text-center text-gray-400 text-[10px]">
        <p>© 2024 - Governo Federal do Brasil</p>
      </div>
    </div>
  );
};

export default Seized;
