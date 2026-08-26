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
      <div className="md:hidden fixed bottom-0 left-0 right-0 min-h-16 border-t border-border bg-sidebar px-2 pt-2 pb-1 z-50 flex items-start justify-around safe-area-bottom">
        {navigation.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.name}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex min-w-[4.25rem] flex-col items-center gap-1 rounded-sm px-2 py-1.5 text-[10px] font-medium transition-colors",
                isActive
                  ? "text-primary"
                  : "text-muted-foreground"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.name}</span>
            </Link>
          );
        })}
      </div>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0 pb-24 md:pb-0 relative overflow-y-auto">
        <header className="md:hidden sticky top-0 z-40 -mx-4 -mt-4 mb-6 flex h-14 items-center justify-between border-b border-border bg-background/95 px-4 backdrop-blur">
          <Link href="/" className="flex items-center gap-2.5" aria-label="TakeKeeper home">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-primary text-sm font-bold tracking-tighter text-primary-foreground">TK</span>
            <span className="text-sm font-bold tracking-tight">TakeKeeper</span>
          </Link>
          <Link
            href="/settings"
            aria-label="Open environment settings"
            className={cn(
              "flex h-10 w-10 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground",
              location === "/settings" && "bg-secondary text-primary",
            )}
          >
            <Settings className="h-4 w-4" />
          </Link>
        </header>
        <div className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8">
          {children}
        </div>
      </main>
    </div>
  );
}