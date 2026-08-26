import { Link, useLocation } from "wouter";
import { LayoutDashboard, Film, ShieldCheck, Activity, Settings } from "lucide-react";
import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface LayoutProps {
  children: ReactNode;
}

export function Shell({ children }: LayoutProps) {
  const [location] = useLocation();

  const navigation = [
    { name: "Dashboard", href: "/", icon: LayoutDashboard },
    { name: "Projects", href: "/projects", icon: Film },
    { name: "Continuity", href: "/continuity", icon: ShieldCheck },
    { name: "Activity", href: "/activity", icon: Activity },
  ];

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Sidebar shell */}
      <nav className="hidden md:flex w-64 flex-col border-r border-border bg-sidebar px-4 py-6 z-10">
        <div className="flex items-center gap-3 px-2 mb-8">
          <div className="w-8 h-8 bg-primary text-primary-foreground flex items-center justify-center font-bold tracking-tighter text-lg rounded-sm">
            TK
          </div>
          <span className="font-bold tracking-tight text-lg">TakeKeeper</span>
        </div>

        <div className="flex flex-col gap-1 flex-1">
          {navigation.map((item) => {
            const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
            return (
              <Link
                key={item.name}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors",
                  isActive
                    ? "bg-secondary text-foreground"
                    : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
                )}
              >
                <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "")} />
                {item.name}
              </Link>
            );
          })}
        </div>
        
        <div className="mt-auto">
          <Link
            href="/settings"
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-sm text-sm font-medium transition-colors",
              location === "/settings"
                ? "bg-secondary text-foreground"
                : "text-muted-foreground hover:bg-secondary/50 hover:text-foreground"
            )}
          >
            <Settings className="w-4 h-4" />
            Environment
          </Link>
        </div>
      </nav>

      {/* Mobile nav */}
      <div className="md:hidden fixed bottom-0 left-0 right-0 border-t border-border bg-sidebar px-4 py-3 z-50 flex items-center justify-between safe-area-bottom">
        {navigation.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              className={cn(
                "flex flex-col items-center gap-1 p-2 rounded-sm text-xs font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="w-5 h-5" />
              <span className="sr-only">{item.name}</span>
            </Link>
          );
        })}
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 pb-16 md:pb-0 relative overflow-y-auto">
        <div className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}