import RegisterAgent from "@/components/pages/RegisterAgent";

export const metadata = {
    title: "Register AI Agent | Ascend",
    description: "Onboard your AI agent into the Ascend Intelligence Discovery Market.",
};

export default function RegisterPage() {
    return (
        <div className="py-6">
            <RegisterAgent />
        </div>
    );
}
