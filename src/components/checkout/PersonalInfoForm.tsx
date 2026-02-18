import { memo, useCallback, useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Check, AlertCircle, Lock } from "lucide-react";

interface FormData {
  name: string;
  document: string;
  email: string;
  phone: string;
}

interface PersonalInfoFormProps {
  formData: FormData;
  touched: Record<string, boolean>;
  onInputChange: (field: keyof FormData, value: string) => void;
  onBlur: (field: string) => void;
}

// CPF mask helper
const formatCPF = (value: string): string => {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

// Full CPF validation
const isValidCPF = (cpf: string): boolean => {
  const digits = cpf.replace(/\D/g, "");
  if (digits.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += parseInt(digits[i]) * (10 - i);
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[9])) return false;
  sum = 0;
  for (let i = 0; i < 10; i++) sum += parseInt(digits[i]) * (11 - i);
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(digits[10])) return false;
  return true;
};

// Valid TLDs — common typos and gibberish are rejected
const VALID_TLDS = new Set([
  "com","net","org","edu","gov","mil","int",
  "co","io","dev","app","me","info","biz","name","pro","museum","aero","coop",
  "br","us","uk","ca","au","de","fr","es","it","pt","nl","be","ch","at","se","no","dk","fi","pl","cz","ru","jp","cn","kr","in","mx","ar","cl","co","pe","uy","py","ec","ve","bo",
  "com.br","net.br","org.br","edu.br","gov.br",
  "co.uk","org.uk","ac.uk","co.in","co.jp","co.kr","com.au","com.ar","com.mx","com.co","com.pe","com.uy","com.py",
  "online","store","shop","site","tech","xyz","club","live","email","gg","tv","cc","ai","cloud","digital","world","global","space","fun","one","top","link","click","work","zone","games","social","team","chat","group",
]);

const isValidEmail = (email: string): boolean => {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return false;
  return true;
};

const getEmailTLDError = (email: string): string | undefined => {
  const trimmed = email.trim();
  if (!trimmed || !trimmed.includes("@")) return undefined;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "E-mail inválido";
  
  const domain = trimmed.split("@")[1]?.toLowerCase();
  if (!domain) return "E-mail inválido";
  
  // Extract TLD (supports compound like .com.br)
  const parts = domain.split(".");
  if (parts.length < 2) return "E-mail inválido";
  
  const tld = parts.slice(-1)[0];
  const compoundTld = parts.slice(-2).join(".");
  
  if (!VALID_TLDS.has(tld) && !VALID_TLDS.has(compoundTld)) {
    return `Domínio ".${tld}" não é válido. Verifique seu e-mail.`;
  }
  return undefined;
};

function ValidationIcon({ isValid, show }: { isValid: boolean; show: boolean }) {
  if (!show) return null;
  return isValid ? (
    <Check className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-green-500" />
  ) : (
    <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-red-500" />
  );
}
export { formatCPF, isValidCPF, isValidEmail, getEmailTLDError };

export const PersonalInfoForm = memo(function PersonalInfoForm({
  formData,
  touched,
  onInputChange,
  onBlur,
}: PersonalInfoFormProps) {
  const validation = useMemo(
    () => ({
      name: formData.name.trim().length >= 3 && formData.name.trim().split(" ").length >= 2,
      nameError:
        formData.name.trim().length < 3
          ? "Nome deve ter pelo menos 3 caracteres"
          : formData.name.trim().split(" ").length < 2
          ? "Digite nome e sobrenome"
          : undefined,
      document: isValidCPF(formData.document),
      documentError:
        formData.document.replace(/\D/g, "").length === 11 && !isValidCPF(formData.document)
          ? "CPF inválido (verifique os dígitos)"
          : formData.document.replace(/\D/g, "").length < 11
          ? "CPF incompleto"
          : undefined,
      email: isValidEmail(formData.email) && !getEmailTLDError(formData.email),
      emailError: (() => {
        if (formData.email.trim().length === 0) return "E-mail é obrigatório";
        if (!isValidEmail(formData.email)) return "E-mail inválido";
        const tldErr = getEmailTLDError(formData.email);
        if (tldErr) return tldErr;
        return undefined;
      })(),
    }),
    [formData]
  );

  const getInputClassName = useCallback(
    (field: "name" | "document" | "email", baseClass: string) => {
      if (!touched[field]) return baseClass;
      return validation[field]
        ? `${baseClass} border-green-500/50 pr-10`
        : `${baseClass} border-red-500/50 pr-10`;
    },
    [touched, validation]
  );

  const inputBase =
    "h-12 bg-background border-border/10 text-foreground placeholder:text-muted-foreground/40 rounded-xl text-[15px] sm:text-[14px]";

  return (
    <div className="bg-secondary/50 rounded-2xl border border-border/10 p-5 sm:p-6 mx-auto w-full max-w-lg lg:max-w-none shadow-lg shadow-black/5">
      <h2 className="text-[15px] font-semibold text-foreground mb-6">Informações do comprador</h2>

      <div className="space-y-4">
        {/* Name + CPF */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label htmlFor="checkout-name" className="block text-[13px] text-muted-foreground mb-2">
              Nome completo <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Input
                id="checkout-name"
                name="name"
                value={formData.name}
                onChange={(e) => onInputChange("name", e.target.value)}
                onBlur={() => onBlur("name")}
                placeholder="Nome Sobrenome"
                autoComplete="name"
                className={getInputClassName("name", `${inputBase} capitalize`)}
              />
              <ValidationIcon isValid={validation.name} show={touched.name || false} />
            </div>
            {touched.name && !validation.name && (
              <p className="text-red-400 text-[11px] mt-1.5">
                {validation.nameError || "Nome inválido"}
              </p>
            )}
          </div>

          <div>
            <label htmlFor="checkout-cpf" className="block text-[13px] text-muted-foreground mb-2">
              CPF <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Input
                id="checkout-cpf"
                name="cpf"
                value={formData.document}
                onChange={(e) => onInputChange("document", e.target.value)}
                onBlur={() => onBlur("document")}
                placeholder="000.000.000-00"
                inputMode="numeric"
                autoComplete="off"
                className={getInputClassName("document", inputBase)}
              />
              <ValidationIcon isValid={validation.document} show={touched.document || false} />
            </div>
            {touched.document && !validation.document && (
              <p className="text-red-400 text-[11px] mt-1.5">
                {validation.documentError || "CPF inválido"}
              </p>
            )}
          </div>
        </div>

        {/* Email + Phone */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label
              htmlFor="checkout-email"
              className="block text-[13px] text-muted-foreground mb-2"
            >
              E-mail <span className="text-red-500">*</span>
            </label>
            <div className="relative">
              <Input
                id="checkout-email"
                name="email"
                value={formData.email}
                onChange={(e) => onInputChange("email", e.target.value)}
                onBlur={() => onBlur("email")}
                placeholder="seuemail@exemplo.com"
                type="email"
                autoComplete="email"
                className={getInputClassName("email", inputBase)}
              />
              <ValidationIcon isValid={validation.email} show={touched.email || false} />
            </div>
            {touched.email && !validation.email && (
              <p className="text-red-400 text-[11px] mt-1.5">
                {validation.emailError || "E-mail inválido"}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="checkout-phone"
              className="block text-[13px] text-muted-foreground mb-2"
            >
              Telefone
            </label>
            <Input
              id="checkout-phone"
              name="phone"
              value={formData.phone}
              onChange={(e) => onInputChange("phone", e.target.value)}
              placeholder="(DDD) 99999-9999"
              type="tel"
              autoComplete="tel"
              className={inputBase}
            />
          </div>
        </div>

        {/* Security microcopy */}
        <p className="text-[12px] text-muted-foreground/60 flex items-center gap-1.5 mt-1">
          <Lock className="w-3.5 h-3.5 flex-shrink-0" />
          Seus dados são seguros e usados apenas para processar seu pedido.
        </p>
      </div>
    </div>
  );
});
