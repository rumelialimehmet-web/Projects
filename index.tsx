import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleGenAI, Type } from "@google/genai";

// --- LOCAL STORAGE HELPERS ---
const STORAGE_KEY = 'payca-data';

const loadDataFromStorage = () => {
    try {
        const data = localStorage.getItem(STORAGE_KEY);
        if (data) {
            const parsedData = JSON.parse(data);
            // Tarihleri ISO string'den Date objesine geri çevir
            if (parsedData.groups) {
                parsedData.groups.forEach(group => {
                    if (group.expenses) {
                        group.expenses.forEach(expense => {
                            if (expense.date) {
                                expense.date = new Date(expense.date);
                            }
                        });
                    }
                     if (group.createdAt) {
                        group.createdAt = new Date(group.createdAt);
                    }
                });
            }
            return parsedData;
        }
    } catch (error) {
        console.error("Local storage'dan veri yüklenemedi", error);
    }
    return { user: null, groups: [] };
};

const saveDataToStorage = (data) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
        console.error("Veri local storage'a kaydedilemedi", error);
    }
};


// --- HELPER FUNCTIONS ---
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('tr-TR', {
        style: 'currency',
        currency: 'TRY',
    }).format(amount);
};

const formatDate = (dateObj) => {
    if (!dateObj) return '';
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
     return new Intl.DateTimeFormat('tr-TR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    }).format(date);
};

const calculateSettlements = (balances) => {
    let debtors = balances.filter(m => m.balance < 0).map(m => ({ ...m, balance: m.balance })).sort((a, b) => a.balance - b.balance);
    let creditors = balances.filter(m => m.balance > 0).map(m => ({ ...m, balance: m.balance })).sort((a, b) => b.balance - a.balance);
    const settlements = [];

    while (debtors.length > 0 && creditors.length > 0) {
        const debtor = debtors[0];
        const creditor = creditors[0];
        const amount = Math.min(-debtor.balance, creditor.balance);

        settlements.push({
            from: debtor,
            to: creditor,
            amount: amount,
        });

        debtor.balance += amount;
        creditor.balance -= amount;

        if (Math.abs(debtor.balance) < 0.01) debtors.shift();
        if (Math.abs(creditor.balance) < 0.01) creditors.shift();
    }
    return settlements;
};

// --- COMPONENTS ---

function FinancialAdvisor({ groups, currentUser, ai }) {
    const [prompt, setPrompt] = useState('');
    const [chatHistory, setChatHistory] = useState([
        { role: 'model', text: 'Merhaba! Ben Payça, yapay zeka finans danışmanın. Harcamalarınla ilgili nasıl yardımcı olabilirim?' }
    ]);
    const [isLoading, setIsLoading] = useState(false);

    const userShares = useMemo(() => {
        const allShares = [];
        groups.forEach(group => {
            (group.expenses || []).forEach(expense => {
                const memberCount = (group.members || []).length;
                if (memberCount === 0) return;
                let userShareAmount = 0;
                if (expense.splitType === 'unequal' && expense.splits?.length > 0) {
                    const userSplit = expense.splits.find(s => s.memberId === currentUser.id);
                    if (userSplit) userShareAmount = userSplit.amount || 0;
                } else {
                    userShareAmount = expense.amount / memberCount;
                }
                if (userShareAmount > 0) {
                    allShares.push({
                        description: expense.description,
                        amount: userShareAmount,
                    });
                }
            });
        });
        return allShares;
    }, [groups, currentUser.id]);

    const financialContext = useMemo(() => {
        const totalSpending = userShares.reduce((sum, share) => sum + share.amount, 0);
        const categories = {};
        userShares.forEach(share => {
            const category = "Genel"; // Kategori mantığı eklenebilir
            categories[category] = (categories[category] || 0) + share.amount;
        });

        return `Kullanıcının finansal durumu özeti: Toplam harcama: ${formatCurrency(totalSpending)}. Kategorilere göre harcamalar: ${JSON.stringify(categories)}.`;
    }, [userShares]);


    const handleSendPrompt = async () => {
        if (!prompt.trim() || isLoading || !ai) {
            if (!ai) {
                 setChatHistory(prev => [...prev, { role: 'model', text: 'Üzgünüm, AI danışman şu anda mevcut değil. API anahtarı eksik olabilir.' }]);
            }
            return;
        }

        const userMessage = { role: 'user', text: prompt };
        setChatHistory(prev => [...prev, userMessage]);
        setIsLoading(true);
        setPrompt('');

        try {
            const fullPrompt = `${financialContext} Bu bağlama göre kullanıcının şu sorusunu cevapla: "${prompt}"`;
            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: fullPrompt,
            });
            const text = response.text;
            setChatHistory(prev => [...prev, { role: 'model', text }]);
        } catch (error) {
            console.error("Gemini API call failed:", error);
            setChatHistory(prev => [...prev, { role: 'model', text: 'Üzgünüm, bir hata oluştu. Lütfen tekrar deneyin.' }]);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className="detail-card financial-advisor-card">
            <h3>Financial Advisor</h3>
            <p className="powered-by">Powered by Gemini</p>
            <div className="chat-window">
                {chatHistory.map((msg, index) => (
                    <div key={index} className={`chat-message ${msg.role}`}>
                        <p>{msg.text}</p>
                    </div>
                ))}
                {isLoading && <div className="chat-message model"><div className="loading-dots"><span>.</span><span>.</span><span>.</span></div></div>}
            </div>
            <div className="chat-input-area">
                <input
                    type="text"
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    placeholder="Bir finansal soru sorun..."
                    onKeyPress={(e) => e.key === 'Enter' && handleSendPrompt()}
                    disabled={isLoading || !ai}
                />
                <button onClick={handleSendPrompt} disabled={isLoading || !ai}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
                </button>
            </div>
        </div>
    );
}


function InstallPwaPrompt({ onInstall, onDismiss, isIOS, hasInstallEvent }) {
    return (
        <div className="install-prompt-banner">
            <div className="install-prompt-text">
                {isIOS
                    ? <p>Uygulamayı yüklemek için: Paylaş butonuna ve ardından <strong>'Ana Ekrana Ekle'</strong> seçeneğine dokunun.</p>
                    : <p>Payça'yı ana ekranınıza ekleyerek daha hızlı erişin!</p>
                }
            </div>
            <div className="install-prompt-actions">
                {hasInstallEvent && !isIOS && <button className="cta-button" onClick={onInstall}>Yükle</button>}
                <button className="dismiss-button" onClick={onDismiss} title="Kapat">&times;</button>
            </div>
        </div>
    );
}

function HelpFeedbackModal({ user, onUpdateUser, onClose, onResetData, onLogout, theme, onThemeChange }) {
    const [activeTab, setActiveTab] = useState('profile');
    const [name, setName] = useState(user.name);
    const [feedbackType, setFeedbackType] = useState('general');
    const [feedbackMessage, setFeedbackMessage] = useState('');

    const themes = [
        { id: 'light', name: 'Aydınlık' },
        { id: 'dark', name: 'Karanlık' },
        { id: 'midnight', name: 'Gece Yarısı' },
        { id: 'sepia', name: 'Sepya' },
        { id: 'forest', name: 'Koyu Yeşil' },
    ];

    const handleProfileUpdate = (e) => {
        e.preventDefault();
        onUpdateUser({ name });
    };

    const handleFeedbackSubmit = (e) => {
        e.preventDefault();
        if (!feedbackMessage.trim()) {
            alert("Lütfen geri bildirim alanını boş bırakmayın.");
            return;
        }
        console.log("Geri Bildirim Gönderildi:", { type: feedbackType, message: feedbackMessage });
        alert("Değerli geri bildiriminiz için teşekkür ederiz!");
        setFeedbackType('general');
        setFeedbackMessage('');
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close-button" onClick={onClose}>&times;</button>
                <h2>Profil & Ayarlar</h2>

                <div className="modal-tabs">
                    <button className={`modal-tab ${activeTab === 'profile' ? 'active' : ''}`} onClick={() => setActiveTab('profile')}>Profil</button>
                    <button className={`modal-tab ${activeTab === 'appearance' ? 'active' : ''}`} onClick={() => setActiveTab('appearance')}>Görünüm</button>
                    <button className={`modal-tab ${activeTab === 'feedback' ? 'active' : ''}`} onClick={() => setActiveTab('feedback')}>Geri Bildirim</button>
                    <button className={`modal-tab ${activeTab === 'data' ? 'active' : ''}`} onClick={() => setActiveTab('data')}>Veri</button>
                </div>

                <div className={`modal-tab-content ${activeTab === 'profile' ? 'active' : ''}`}>
                    <h3>Profil Bilgileri</h3>
                    <form onSubmit={handleProfileUpdate}>
                        <div className="form-group">
                            <label htmlFor="userName">Adınız</label>
                            <input id="userName" type="text" value={name} onChange={(e) => setName(e.target.value)} />
                        </div>
                        <button type="submit" className="form-button">Güncelle</button>
                    </form>
                </div>

                <div className={`modal-tab-content ${activeTab === 'appearance' ? 'active' : ''}`}>
                    <h3>Tema Seçimi</h3>
                    <p>Uygulamanın görünümünü kişiselleştir.</p>
                    <div className="theme-selector-grid">
                        {themes.map(themeOption => (
                            <div
                                key={themeOption.id}
                                className={`theme-card ${theme === themeOption.id ? 'active' : ''}`}
                                onClick={() => onThemeChange(themeOption.id)}
                            >
                                <div className="theme-preview" data-theme-id={themeOption.id}>
                                    <div className="theme-preview-bg"></div>
                                    <div className="theme-preview-accent"></div>
                                </div>
                                <p>{themeOption.name}</p>
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`modal-tab-content ${activeTab === 'feedback' ? 'active' : ''}`}>
                    <h3>Geri Bildirim Gönder</h3>
                    <p>Uygulamayı geliştirmemize yardımcı olun. Fikirlerinizi ve karşılaştığınız sorunları bizimle paylaşın.</p>
                    <form onSubmit={handleFeedbackSubmit}>
                        <div className="form-group">
                            <label htmlFor="feedbackType">Geri Bildirim Türü</label>
                            <select id="feedbackType" value={feedbackType} onChange={(e) => setFeedbackType(e.target.value)}>
                                <option value="general">Genel Geri Bildirim</option>
                                <option value="bug">Hata Bildirimi</option>
                                <option value="feature">Özellik İsteği</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label htmlFor="feedbackMessage">Mesajınız</label>
                            <textarea
                                id="feedbackMessage"
                                rows={5}
                                value={feedbackMessage}
                                onChange={(e) => setFeedbackMessage(e.target.value)}
                                placeholder="Düşüncelerinizi buraya yazın..."
                                required
                            />
                        </div>
                        <button type="submit" className="form-button" style={{width: '100%'}}>Gönder</button>
                    </form>
                </div>

                <div className={`modal-tab-content ${activeTab === 'data' ? 'active' : ''}`}>
                     <h3>Veri Yönetimi</h3>
                     <p>Bu eylemler geri alınamaz. Lütfen dikkatli olun.</p>
                     <button className="form-button" style={{ background: 'var(--danger-color)', width: '100%', marginTop: '16px' }} onClick={onResetData}>
                        Tüm Grupları Sil
                     </button>
                </div>

                 <div style={{borderTop: '1px solid var(--border-color)', marginTop: '24px', paddingTop: '24px', display: 'flex', justifyContent: 'center'}}>
                      <button className="secondary-button" onClick={onLogout} style={{ background: 'var(--danger-color)', color: 'white' }}>Çıkış Yap</button>
                 </div>
            </div>
        </div>
    );
}

// FIX: Define missing components.
function SettlementScreen({ group, onNavigate }) {
    const balances = useMemo(() => {
        const memberBalances: { [key: string]: { id: string, name: string, balance: number } } = {};
        (group.members || []).forEach(member => {
            memberBalances[member.id] = { id: member.id, name: member.name, balance: 0 };
        });

        if (!group.members || group.members.length === 0) return [];

        (group.expenses || []).forEach(expense => {
            if (memberBalances[expense.paidBy]) {
                memberBalances[expense.paidBy].balance += expense.amount;
            }

            if (expense.splitType === 'unequal' && expense.splits?.length > 0) {
                expense.splits.forEach(split => {
                    if (memberBalances[split.memberId]) {
                        memberBalances[split.memberId].balance -= (split.amount || 0);
                    }
                });
            } else {
                const sharePerMember = expense.amount / group.members.length;
                group.members.forEach(member => {
                    memberBalances[member.id].balance -= sharePerMember;
                });
            }
        });

        return Object.values(memberBalances);
    }, [group.expenses, group.members]);

    const settlements = useMemo(() => calculateSettlements(balances), [balances]);

    return (
        <div>
            <div className="detail-header">
                 <button onClick={() => onNavigate('groupDetail', group.id)} className="back-button">‹ Geri</button>
                <h2>Hesaplaşma: {group.name}</h2>
            </div>
            <div className="detail-card">
                <h3>Ödeme Adımları</h3>
                {settlements.length > 0 ? (
                    <ul className="settlement-list">
                        {settlements.map((s, index) => (
                            <li key={index}>
                                <span className="debtor">{s.from.name}</span>
                                <span className="arrow">→</span>
                                <span className="creditor">{s.to.name}</span>
                                <span className="amount">{formatCurrency(s.amount)}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>Herkesin hesabı eşit. Ödeme yapılmasına gerek yok.</p>
                )}
            </div>
        </div>
    );
}

function AnalyticsScreen({ groups, currentUser, onNavigate }) {
    const totalSpent = useMemo(() => {
        return groups.reduce((total, group) => {
            return total + (group.expenses || []).reduce((groupTotal, expense) => groupTotal + expense.amount, 0);
        }, 0);
    }, [groups]);

    const expensesByCategory = useMemo(() => {
        const categories = {};
        groups.forEach(group => {
            (group.expenses || []).forEach(expense => {
                const category = expense.category || 'Diğer';
                categories[category] = (categories[category] || 0) + expense.amount;
            });
        });
        return Object.entries(categories).sort(([, a], [, b]) => b - a);
    }, [groups]);

    return (
        <div>
            <div className="detail-header">
                <h2>İstatistikler</h2>
                <button onClick={() => onNavigate('dashboard')} className="back-button">‹ Geri</button>
            </div>
            <div className="analytics-grid">
                <div className="detail-card">
                    <h3>Toplam Harcama</h3>
                    <p className="stat-number">{formatCurrency(totalSpent)}</p>
                </div>
                <div className="detail-card">
                    <h3>Kategoriye Göre Harcamalar</h3>
                    <ul className="category-list">
                        {expensesByCategory.map(([category, amount]) => (
                            <li key={category}>
                                <span>{category}</span>
                                <span>{formatCurrency(amount)}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
}

function OnboardingModal({ onComplete }) {
    return (
        <div className="modal-overlay">
            <div className="modal-content">
                <h2>Payça'ya Hoş Geldin!</h2>
                <p>Harcamalarını kolayca takip etmeye ve arkadaşlarınla paylaşmaya hazırsın.</p>
                <p>Başlamak için ilk grubunu oluşturabilirsin.</p>
                <button className="form-button" onClick={onComplete}>Anladım, Başlayalım!</button>
            </div>
        </div>
    );
}

function AppFooter({ syncStatus, lastSyncTime }) {
    const formatSyncTime = (date) => {
        if (!date) return '';
        return date.toLocaleTimeString('tr-TR', {
            hour: '2-digit',
            minute: '2-digit',
        });
    };

    const renderSyncStatus = () => {
        if (!lastSyncTime) return null; // Don't show until first successful save/load

        switch (syncStatus) {
            case 'saving':
                return <><div className="sync-spinner"></div> Kaydediliyor...</>;
            case 'synced':
                return <span className="sync-synced">✓ Veriler yerel olarak kaydedildi ({formatSyncTime(lastSyncTime)})</span>;
            case 'error':
                return <span className="sync-error">✗ Kaydetme başarısız oldu</span>;
            default:
                return null;
        }
    };

    return (
        <footer className="app-footer">
            <div className="sync-status-container">
                {renderSyncStatus()}
            </div>
            <p>&copy; {new Date().getFullYear()} Payça. Tüm hakları saklıdır.</p>
        </footer>
    );
}

function App() {
    const [ai, setAi] = useState(null);
    const [user, setUser] = useState(null);
    const [groups, setGroups] = useState([]);
    const [currentView, setCurrentView] = useState('dashboard');
    const [selectedGroupId, setSelectedGroupId] = useState(null);
    const [successMessage, setSuccessMessage] = useState('');
    const [installPromptEvent, setInstallPromptEvent] = useState(null);
    const [showInstallPrompt, setShowInstallPrompt] = useState(false);
    const [theme, setTheme] = useState(() => localStorage.getItem('payca-theme') || 'dark');
    const [showOnboarding, setShowOnboarding] = useState(false);
    const [showHelpFeedbackModal, setShowHelpFeedbackModal] = useState(false);
    const [authModal, setAuthModal] = useState({ isOpen: false, view: 'login' });
    const [isDataLoaded, setIsDataLoaded] = useState(false);
    const [pendingInvite, setPendingInvite] = useState(null);
    const [syncStatus, setSyncStatus] = useState('synced');
    const [lastSyncTime, setLastSyncTime] = useState(null);

    // FIX: Using `new RegExp()` avoids a parser ambiguity that could cause a spurious "arithmetic operation" error.
    const isIOS = useMemo(() => new RegExp('iPad|iPhone|iPod').test(navigator.userAgent) && !(window as any).MSStream, []);
    const isStandalone = useMemo(() => window.matchMedia('(display-mode: standalone)').matches, []);

    // Veri yükleme, davet linki ve Gemini başlatma
    useEffect(() => {
        // Gemini'yi başlat
        try {
            const apiKey = process.env.API_KEY;
            if (apiKey) {
                const genAI = new GoogleGenAI({ apiKey });
                setAi(genAI);
            } else {
                console.error("Gemini API anahtarı eksik. Finansal danışman devre dışı bırakıldı.");
            }
        } catch (error) {
            console.error("Gemini AI başlatılırken hata oluştu:", error);
        }

        // Local storage'dan veri yükle
        const { user: storedUser, groups: storedGroups } = loadDataFromStorage();
        const urlParams = new URLSearchParams(window.location.search);
        const joinData = urlParams.get('joinData');

        const processInvite = (data, currentGroups) => {
             try {
                const decodedString = atob(data);
                const newGroupData = JSON.parse(decodedString);
                const newGroup = { ...newGroupData, id: `group_${Date.now()}` };

                if (currentGroups.some(g => g.name === newGroup.name)) {
                    alert(`'${newGroup.name}' adında bir gruba zaten üyesiniz.`);
                    return currentGroups;
                }
                setSuccessMessage(`'${newGroup.name}' grubuna başarıyla katıldınız!`);
                return [...currentGroups, newGroup];
            } catch (error) {
                console.error("Davet verisi işlenirken hata oluştu:", error);
                alert("Geçersiz davet linki.");
                return currentGroups;
            } finally {
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        };
        
        if (storedUser) {
            setUser(storedUser);
            let currentGroups = storedGroups || [];
            if (joinData) {
                 currentGroups = processInvite(joinData, currentGroups);
            }
            setGroups(currentGroups);
            setLastSyncTime(new Date());
        } else {
             if (joinData) {
                setPendingInvite(joinData);
            }
        }
        
        setIsDataLoaded(true);
    }, []);
    
    // Değişiklikleri local storage'a kaydet
    useEffect(() => {
        if(isDataLoaded) {
            setSyncStatus('saving');
            const timer = setTimeout(() => {
                try {
                    saveDataToStorage({ user, groups });
                    setSyncStatus('synced');
                    setLastSyncTime(new Date());
                } catch (error) {
                    console.error("Veri local storage'a kaydedilemedi", error);
                    setSyncStatus('error');
                }
            }, 1000);

            return () => clearTimeout(timer);
        }
    }, [user, groups, isDataLoaded]);

    useEffect(() => {
        document.body.setAttribute('data-theme', theme);
        localStorage.setItem('payca-theme', theme);
    }, [theme]);

    useEffect(() => {
        if (successMessage) {
            const timer = setTimeout(() => setSuccessMessage(''), 3000);
            return () => clearTimeout(timer);
        }
    }, [successMessage]);

    useEffect(() => {
        const handleBeforeInstallPrompt = (e) => {
            e.preventDefault();
            setInstallPromptEvent(e);
            if (!isStandalone) {
                setShowInstallPrompt(true);
            }
        };
        window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
        if (isIOS && !isStandalone) {
            setShowInstallPrompt(true);
        }
        return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    }, [isIOS, isStandalone]);

    const handleLogin = () => {
        const newUser = {
            id: `local_user_${Date.now()}`,
            name: 'Demo Kullanıcı',
            email: '',
            createdAt: new Date().toISOString()
        };
        setUser(newUser);

        let initialGroups = [];
        if (pendingInvite) {
            try {
                const decodedString = atob(pendingInvite);
                const newGroupData = JSON.parse(decodedString);
                const newGroup = { ...newGroupData, id: `group_${Date.now()}` };
                initialGroups = [newGroup];
                setSuccessMessage(`'${newGroup.name}' grubuna başarıyla katıldınız!`);
            } catch (error) {
                console.error("Bekleyen davet verisi işlenirken hata oluştu:", error);
                alert("Geçersiz davet linki.");
            } finally {
                setPendingInvite(null);
                window.history.replaceState({}, document.title, window.location.pathname);
            }
        }
        
        setGroups(initialGroups);
        setAuthModal({ isOpen: false, view: 'login' });
    };

    const handleLogout = () => {
        setUser(null);
        setGroups([]);
        handleNavigate('dashboard');
    };

    const handleUpdateUser = async (updatedUserData) => {
         if (!user) return;
        setUser(prevUser => ({...prevUser, ...updatedUserData}));
        setSuccessMessage("Profil başarıyla güncellendi!");
    }

    const handleThemeToggle = () => {
        const isDarkTheme = ['dark', 'midnight', 'forest'].includes(theme);
        setTheme(isDarkTheme ? 'light' : 'dark');
    };

    const handleResetData = async () => {
        if (window.confirm("Tüm gruplarınızı silmek istediğinizden emin misiniz? Bu işlem geri alınamaz.")) {
             if (user) {
                setGroups([]);
                setSuccessMessage('Tüm gruplar başarıyla silindi.');
                handleNavigate('dashboard');
            }
        }
    };

    const handleInstallClick = () => {
        if (!installPromptEvent) return;
        installPromptEvent.prompt();
        installPromptEvent.userChoice.then(() => {
            setInstallPromptEvent(null);
            setShowInstallPrompt(false);
        });
    };

    const handleNavigate = (view, groupId = null) => {
        setCurrentView(view);
        setSelectedGroupId(groupId);
    };

    const handleOnboardingComplete = () => {
        setShowOnboarding(false);
    };

    const handleCreateGroup = async (newGroupData) => {
        if (!user) return;
        
        const otherMembers = newGroupData.members.filter(m => m.name.trim().toLowerCase() !== user.name.trim().toLowerCase());
        const membersWithUser = [{ id: user.id, name: user.name }, ...otherMembers];
        
        const newGroup = {
            ...newGroupData,
            id: `group_${Date.now()}`,
            ownerId: user.id,
            createdAt: new Date().toISOString(),
            currency: 'TRY',
            members: membersWithUser,
            expenses: [] 
        };

        setGroups(prevGroups => [...prevGroups, newGroup]);
        
        setSuccessMessage('Grup başarıyla oluşturuldu!');
        handleNavigate('dashboard');
    };

    const handleAddExpense = async (groupId, newExpense) => {
        if (!user || !groupId) return;

        setGroups(prevGroups => prevGroups.map(group => {
            if (group.id === groupId) {
                 const updatedExpenses = [
                    ...(group.expenses || []),
                    { ...newExpense, id: `exp_${Date.now()}`, date: new Date().toISOString() }
                ];
                return { ...group, expenses: updatedExpenses };
            }
            return group;
        }));

        setSuccessMessage('Harcama başarıyla eklendi!');
    };

    const selectedGroup = useMemo(() =>
        groups.find(g => g.id === selectedGroupId),
        [groups, selectedGroupId]
    );

    if (!isDataLoaded) {
        return <div style={{textAlign: 'center', paddingTop: '40vh', fontSize: '1.2rem'}}>Yükleniyor...</div>
    }

    if (!user) {
        return (
            <>
                <LandingPage onShowAuth={(view) => setAuthModal({ isOpen: true, view })} />
                {authModal.isOpen && <AuthModal onLogin={handleLogin} onClose={() => setAuthModal({ isOpen: false, view: 'login' })} />}
                <AppFooter syncStatus={syncStatus} lastSyncTime={lastSyncTime} />
            </>
        );
    }

    const renderContent = () => {
        if (!selectedGroup && (currentView === 'groupDetail' || currentView === 'settlement')) {
            handleNavigate('dashboard');
            return null;
        }
        switch (currentView) {
            case 'createGroup':
                return <CreateGroupScreen onCreateGroup={handleCreateGroup} onNavigate={handleNavigate} currentUser={user} />;
            case 'groupDetail':
                return <GroupDetail group={selectedGroup} onNavigate={handleNavigate} onAddExpense={handleAddExpense} currentUser={user} setSuccessMessage={setSuccessMessage} ai={ai} />;
            case 'settlement':
                return <SettlementScreen group={selectedGroup} onNavigate={handleNavigate} />;
            case 'analytics':
                return <AnalyticsScreen groups={groups} currentUser={user} onNavigate={handleNavigate} />;
            case 'dashboard':
            default:
                return (
                    <div className="dashboard-layout">
                        <div className="dashboard-main">
                            <GroupsList groups={groups} onSelectGroup={(id) => handleNavigate('groupDetail', id)} />
                             {groups.length === 0 && <WelcomeScreen onCreateGroup={() => handleNavigate('createGroup')} />}
                        </div>
                        <div className="dashboard-sidebar">
                            <FinancialAdvisor groups={groups} currentUser={user} ai={ai} />
                        </div>
                    </div>
                );
        }
    };

    const isDarkTheme = ['dark', 'midnight', 'forest'].includes(theme);

    return (
        <div className="container">
            {showInstallPrompt && <InstallPwaPrompt onInstall={handleInstallClick} onDismiss={() => setShowInstallPrompt(false)} isIOS={isIOS} hasInstallEvent={!!installPromptEvent} />}
            {showOnboarding && <OnboardingModal onComplete={handleOnboardingComplete} />}
            {showHelpFeedbackModal && <HelpFeedbackModal user={user} onUpdateUser={handleUpdateUser} onClose={() => setShowHelpFeedbackModal(false)} onResetData={handleResetData} onLogout={handleLogout} theme={theme} onThemeChange={setTheme} />}

            <header className="app-header">
                <div className="logo" onClick={() => handleNavigate('dashboard')}>
                    <div className="hexagon"></div>
                    <h1>Payça</h1>
                </div>
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'center' }}>
                    <span style={{ fontWeight: 600 }}>Merhaba, {user.name.split(' ')[0]}</span>
                    <button className="cta-button" onClick={() => handleNavigate('createGroup')}>Yeni Grup</button>
                    <button className="secondary-button" onClick={() => handleNavigate('analytics')}>İstatistikler</button>
                    <button className="secondary-button" onClick={() => setShowHelpFeedbackModal(true)}>Profil & Ayarlar</button>
                    <button className="theme-toggle-button" onClick={handleThemeToggle} title="Temayı Değiştir">
                        {isDarkTheme ? '☀️' : '🌙'}
                    </button>
                    <button className="secondary-button" onClick={handleLogout} style={{ background: 'var(--danger-color)', color: 'white' }}>Çıkış Yap</button>
                </div>
            </header>
            {successMessage && <div className={`success-toast ${successMessage ? 'show' : ''}`}>{successMessage}</div>}
            <main>{renderContent()}</main>
            <AppFooter syncStatus={syncStatus} lastSyncTime={lastSyncTime} />
        </div>
    );
}

function LandingPage({ onShowAuth }) {
    return (
        <div className="welcome-container">
            <div className="welcome-card" style={{ padding: '60px' }}>
                <div className="logo" style={{ justifyContent: 'center', marginBottom: '16px' }}>
                    <div className="hexagon"></div>
                    <h1>Payça</h1>
                </div>
                <h2>Masrafları Kolayca Paylaşın</h2>
                <p className="subtitle">Arkadaş grupları, ev arkadaşları ve tatiller için harcamaları takip etmenin en basit yolu.</p>
                <div className="landing-actions">
                    <button className="cta-button" onClick={() => onShowAuth('register')} style={{ fontSize: '1.1rem', padding: '14px' }}>
                        Giriş Yap / Kayıt Ol
                    </button>
                </div>
                 <div style={{ marginTop: '24px', fontSize: '0.9rem', color: 'var(--text-secondary)'}}>
                    Tüm verileriniz cihazınızda güvenle saklanır.
                 </div>
            </div>
        </div>
    );
}

function AuthModal({ onLogin, onClose }) {
    const handleLocalAuth = () => {
        onLogin();
    };

    return (
         <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content auth-modal-content" onClick={(e) => e.stopPropagation()}>
                <button className="modal-close-button" onClick={onClose}>&times;</button>
                <h2>Giriş Yap veya Kayıt Ol</h2>
                <button className="gmail-button" onClick={handleLocalAuth}>
                    <svg width="18" height="18" viewBox="0 0 18" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M17.64 9.20455C17.64 8.56682 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5618V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/><path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5618C11.2418 14.1018 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/><path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29H0.957275V9.62182C0.347727 7.545 0.347727 5.31818 0.957275 3.24L3.96409 5.57182C4.67182 3.44455 6.65591 1.86136 9 1.86136C10.3214 1.86136 11.5077 2.33864 12.4405 3.20455L15.0218 0.623182C13.4632 -0.209545 11.4259 -0.636364 9 -0.636364C5.48182 -0.636364 2.43818 1.38136 0.957275 4.32273C-0.319091 6.99545 -0.319091 11.0045 0.957275 13.6773L3.96409 10.71Z" fill="#FBBC05"/><path d="M9 3.57955C10.7182 3.57955 12.0273 4.22727 12.6886 4.85227L15.0805 2.46C13.4632 0.927273 11.43 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/></svg>
                    Misafir Olarak Devam Et
                </button>
                <div className="auth-separator"></div>
                <p style={{textAlign: 'center', color: 'var(--text-secondary)'}}>Giriş yaptığınızda verileriniz sadece bu cihazda saklanır.</p>
            </div>
        </div>
    );
}

function CreateGroupScreen({ onCreateGroup, onNavigate, currentUser }) {
    const [groupName, setGroupName] = useState('');
    const [description, setDescription] = useState('');
    const [members, setMembers] = useState([{ id: 1, name: '' }]);
    const [nextMemberId, setNextMemberId] = useState(2);

    const handleMemberNameChange = (id, newName) => {
        setMembers(members.map(m => m.id === id ? { ...m, name: newName } : m));
    };

    const handleAddMember = () => {
        setMembers([...members, { id: nextMemberId, name: '' }]);
        setNextMemberId(prevId => prevId + 1);
    };

    const handleRemoveMember = (id) => {
        setMembers(members.filter(m => m.id !== id));
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        const validMembers = members
            .filter(m => m.name.trim() !== '')
            .map((m, index) => ({ name: m.name.trim(), id: `temp_${Date.now() + index}` }));

        if (groupName.trim()) {
            onCreateGroup({
                name: groupName,
                description,
                members: validMembers,
                type: 'Genel',
            });
        } else {
            alert("Lütfen grup adını girin.");
        }
    };

    const isFormValid = groupName.trim() !== '';

    return (
        <div>
            <div className="detail-header">
                <h2>Yeni Grup Oluştur</h2>
                <button onClick={() => onNavigate('dashboard')} className="back-button">‹ İptal</button>
            </div>
            <div className="detail-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label htmlFor="groupName">Grup Adı</label>
                        <input id="groupName" type="text" value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder="Örn: Ev Arkadaşları" required />
                    </div>
                     <div className="form-group">
                        <label htmlFor="description">Açıklama (Opsiyonel)</label>
                        <input id="description" type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Kira, faturalar vb." />
                    </div>
                    <div className="form-group">
                        <label>Üyeler ({currentUser.name} otomatik olarak eklendi)</label>
                        {members.map((member, index) => (
                            <div key={member.id} style={{ display: 'flex', gap: '8px', marginBottom: '8px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    value={member.name}
                                    onChange={(e) => handleMemberNameChange(member.id, e.target.value)}
                                    placeholder={`Arkadaşının Adı ${index + 1}`}
                                />
                                <button type="button" onClick={() => handleRemoveMember(member.id)} style={{ background: 'var(--danger-color)', border: 'none', color: 'white', borderRadius: '8px', cursor: 'pointer', padding: '0 12px', height: '38px', flexShrink: 0 }}>X</button>
                            </div>
                        ))}
                        <button type="button" onClick={handleAddMember} style={{ width: '100%', padding: '10px', background: 'var(--surface-color-light)', border: '1px solid var(--border-color)', borderRadius: '8px', color: 'var(--text-primary)', cursor: 'pointer', marginTop: '8px' }}>+ Üye Ekle</button>
                    </div>
                    <button type="submit" className="form-button" disabled={!isFormValid}>Grubu Oluştur</button>
                </form>
            </div>
        </div>
    );
}

function WelcomeScreen({ onCreateGroup }) {
    return (
         <div className="welcome-container">
            <div className="welcome-card">
                <h2>İlk Grubunu Oluştur</h2>
                <p className="subtitle">Başlamak için yeni bir grup oluşturarak masraflarını takip et.</p>
                <button className="cta-button" onClick={onCreateGroup}>Grup Oluştur</button>
            </div>
         </div>
    );
}

function GroupsList({ groups, onSelectGroup }) {
    const groupIcons = { 'Ev Arkadaşları': '🏠', 'Tatil Grubu': '✈️', 'Etkinlik': '🎉', 'Genel': '📝' };
    return (
        <div className="groups-grid">
            {groups.map(group => (
                <div key={group.id} className="group-card" onClick={() => onSelectGroup(group.id)}>
                    <div>
                        <div className="group-card-header">
                            <span className="group-card-icon">{groupIcons[group.type] || '📝'}</span>
                            <h3>{group.name}</h3>
                        </div>
                        <p>{group.description || 'Grup açıklaması yok.'}</p>
                    </div>
                    <div className="group-card-footer">
                        <span>{group.members?.length || 0} üye</span>
                        <span className="group-card-details-btn">Grup Detayı</span>
                    </div>
                </div>
            ))}
        </div>
    );
}

function fileToGenerativePart(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      resolve({
        inlineData: {
          data: (reader.result as string).split(',')[1],
          mimeType: file.type,
        },
      });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function GroupDetail({ group, onNavigate, onAddExpense, currentUser, setSuccessMessage, ai }) {
    const [newExpense, setNewExpense] = useState({ description: '', amount: '', paidBy: currentUser.id || '', splitType: 'equal', splits: [], category: 'Diğer' });
    const [error, setError] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const fileInputRef = useRef(null);

    useEffect(() => {
        setNewExpense({
            description: '',
            amount: '',
            paidBy: currentUser.id || '',
            splitType: 'equal',
            splits: [],
            category: 'Diğer'
        });
    }, [group, currentUser.id]);
    
    const handleInviteMember = () => {
        const groupDataString = JSON.stringify(group);
        const encodedData = btoa(groupDataString);
        const inviteLink = `${window.location.origin}${window.location.pathname}?joinData=${encodedData}`;
        
        navigator.clipboard.writeText(inviteLink).then(() => {
            setSuccessMessage('Davet linki panoya kopyalandı!');
        }).catch(err => {
            console.error('Link kopyalanamadı: ', err);
            alert('Davet linki kopyalanamadı. Lütfen manuel olarak kopyalayın.');
        });
    };
    
    const handleScanClick = () => {
        if (!ai) {
            alert("AI servisi aktif değil. Lütfen API anahtarını kontrol edin.");
            return;
        }
        fileInputRef.current.click();
    };

    const handleFileChange = async (event) => {
        const file = event.target.files[0];
        if (!file) return;

        setIsScanning(true);
        try {
            const imagePart = await fileToGenerativePart(file);
            const textPart = { text: "Bu fişi analiz et ve mağaza adı ile toplam tutarı çıkar." };

            const response = await ai.models.generateContent({
              model: 'gemini-2.5-flash',
              contents: { parts: [textPart, imagePart] },
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        merchant: {
                          type: Type.STRING,
                          description: "Mağazanın veya satıcının adı."
                        },
                        total: {
                          type: Type.NUMBER,
                          description: "Fişteki toplam tutar."
                        }
                    },
                    required: ["merchant", "total"]
                }
              }
            });
            const text = response.text;
            const parsedData = JSON.parse(text);

            if (parsedData.merchant && parsedData.total) {
                setNewExpense(prev => ({
                    ...prev,
                    description: `${parsedData.merchant} Alışverişi`,
                    amount: parsedData.total.toString(),
                }));
                setSuccessMessage("Fiş başarıyla okundu!");
            } else {
                throw new Error("Yanıt beklenen formatta değil.");
            }
            
        } catch (error) {
            console.error("Fiş taranırken hata oluştu:", error);
            alert("Fiş okunurken bir hata oluştu. Lütfen fotoğrafın net olduğundan emin olun ve tekrar deneyin.");
        } finally {
            setIsScanning(false);
            event.target.value = null;
        }
    };


    const totalExpenses = useMemo(() =>
        (group.expenses || []).reduce((sum, expense) => sum + expense.amount, 0),
        [group.expenses]
    );

    const balances = useMemo(() => {
        const memberBalances: { [key: string]: { id: string, name: string, balance: number } } = {};
        (group.members || []).forEach(member => {
            memberBalances[member.id] = { id: member.id, name: member.name, balance: 0 };
        });

        if (!group.members || group.members.length === 0) return [];

        (group.expenses || []).forEach(expense => {
            if (memberBalances[expense.paidBy]) {
                memberBalances[expense.paidBy].balance += expense.amount;
            }

            if (expense.splitType === 'unequal' && expense.splits?.length > 0) {
                expense.splits.forEach(split => {
                    if (memberBalances[split.memberId]) {
                        memberBalances[split.memberId].balance -= (split.amount || 0);
                    }
                });
            } else {
                const sharePerMember = expense.amount / group.members.length;
                group.members.forEach(member => {
                    memberBalances[member.id].balance -= sharePerMember;
                });
            }
        });

        return Object.values(memberBalances);
    }, [group.expenses, group.members]);

    const settlementSuggestions = useMemo(() => {
        const settlements = calculateSettlements(balances);
        return settlements.map(s => `${s.from.name}, ${s.to.name}'e ${formatCurrency(s.amount)} ödeyebilir.`);
    }, [balances]);

    const handleInputChange = (e) => {
        const { name, value } = e.target;
        if (name === 'splitType') {
            const newSplits = value === 'unequal'
                ? (group.members || []).map(m => ({ memberId: m.id, amount: '' }))
                : [];
            setNewExpense(prev => ({ ...prev, [name]: value, splits: newSplits }));
        } else {
            setNewExpense(prev => ({ ...prev, [name]: value }));
        }
    };

    const handleCustomSplitChange = (memberId, value) => {
        setNewExpense(prev => {
            const newSplits = prev.splits.map(s =>
                s.memberId === memberId ? { ...s, amount: value } : s
            );
            return { ...prev, splits: newSplits };
        });
    };

    const handleShareSummary = () => {
        let summary = `*Payça Grup Özeti: ${group.name}*\n\n`;
        summary += `Toplam Harcama: *${formatCurrency(totalExpenses)}*\n\n`;
        summary += "*Güncel Bakiye Durumu:*\n";
        balances.forEach(b => {
            const balanceText = b.balance >= 0 ? `(Alacaklı: ${formatCurrency(b.balance)})` : `(Borçlu: ${formatCurrency(b.balance)})`;
            summary += `- ${b.name}: ${balanceText}\n`;
        });

        const encodedMessage = encodeURIComponent(summary);
        window.open(`https://wa.me/?text=${encodedMessage}`, '_blank');
    };

    const customSplitTotal = useMemo(() => {
        if (newExpense.splitType !== 'unequal') return 0;
        return newExpense.splits.reduce((sum, split) => sum + (parseFloat(split.amount) || 0), 0);
    }, [newExpense.splits, newExpense.splitType]);

    const remainingToSplit = useMemo(() => {
        const totalAmount = parseFloat(newExpense.amount) || 0;
        return totalAmount - customSplitTotal;
    }, [newExpense.amount, customSplitTotal]);

    const handleSubmit = (e) => {
        e.preventDefault();
        const amount = parseFloat(newExpense.amount);
        if (!newExpense.description || !amount || amount <= 0 || !newExpense.paidBy) {
            setError('Lütfen tüm alanları doğru doldurun.');
            return;
        }
         if (newExpense.splitType === 'unequal' && Math.abs(remainingToSplit) > 0.01) {
            setError('Kişiye özel tutarların toplamı, harcama tutarına eşit olmalıdır.');
            return;
        }
        const expenseToAdd = {
            description: newExpense.description,
            amount: amount,
            paidBy: newExpense.paidBy,
            splitType: newExpense.splitType,
            category: newExpense.category,
            splits: newExpense.splitType === 'unequal'
                ? newExpense.splits.map(s => ({...s, amount: parseFloat(s.amount) || 0}))
                : []
        };

        onAddExpense(group.id, expenseToAdd);
        setNewExpense({ description: '', amount: '', paidBy: currentUser.id, splitType: 'equal', splits: [], category: 'Diğer' });
        setError('');
    };

    const isFormInvalid = !newExpense.description ||
        !newExpense.amount ||
        parseFloat(newExpense.amount) <= 0 ||
        !newExpense.paidBy ||
        (newExpense.splitType === 'unequal' && Math.abs(remainingToSplit) > 0.01);

    return (
        <div>
            {isScanning && (
                 <div className="scanner-overlay">
                    <div className="scanner-processing">
                        <div className="spinner"></div>
                        <p>Fiş Taranıyor...</p>
                    </div>
                </div>
            )}
            <input
                type="file"
                ref={fileInputRef}
                style={{ display: 'none' }}
                accept="image/*"
                onChange={handleFileChange}
            />
            <div className="detail-header">
                <button onClick={() => onNavigate('dashboard')} className="back-button">‹ Geri</button>
                <h2>{group.name}</h2>
                <div className="share-actions-container">
                    <button className="secondary-button" onClick={handleInviteMember}>Üye Davet Et</button>
                    <button className="share-button" onClick={handleShareSummary}>Paylaş</button>
                    <div className="export-button">
                        Dışa Aktar
                        <div className="export-options">
                            <button onClick={() => alert('Grup özeti Excel\'e aktarıldı (simülasyon).')}>Excel'e Aktar (.xlsx)</button>
                            <button onClick={() => alert('Grup özeti PDF olarak kaydedildi (simülasyon).')}>PDF Olarak Kaydet</button>
                        </div>
                    </div>
                </div>
            </div>
            <div className="total-expense">
                <h3>Toplam Harcama</h3>
                <p>{formatCurrency(totalExpenses)}</p>
            </div>
            <div className="detail-grid">
                <div className="detail-card">
                    <h3>Harcama Ekle</h3>
                    <form onSubmit={handleSubmit}>
                        <div className="form-group">
                            <div className="label-container">
                                <label htmlFor="description">Ne için?</label>
                                <button type="button" className="icon-button" title="Fiş Tara" onClick={handleScanClick}>📸</button>
                            </div>
                            <input type="text" id="description" name="description" placeholder="Market alışverişi" value={newExpense.description} onChange={handleInputChange} />
                        </div>
                        <div className="form-group">
                            <label htmlFor="amount">Tutar</label>
                            <input type="number" id="amount" name="amount" placeholder="0,00" value={newExpense.amount} onChange={handleInputChange} step="0.01" />
                        </div>
                        <div className="form-group">
                            <label htmlFor="category">Kategori</label>
                            <select id="category" name="category" value={newExpense.category} onChange={handleInputChange}>
                                <option value="Yemek">Yemek</option>
                                <option value="Ulaşım">Ulaşım</option>
                                <option value="Fatura">Fatura</option>
                                <option value="Kira">Kira</option>
                                <option value="Eğlence">Eğlence</option>
                                <option value="Diğer">Diğer</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label htmlFor="paidBy">Kim ödedi?</label>
                            <select id="paidBy" name="paidBy" value={newExpense.paidBy} onChange={handleInputChange}>
                                {(group.members || []).map(member => (
                                    <option key={member.id} value={member.id}>{member.name}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Paylaşım Türü</label>
                            <select name="splitType" value={newExpense.splitType} onChange={handleInputChange}>
                                <option value="equal">Eşit Paylaş</option>
                                <option value="unequal">Eşit Olmayan Paylaşım</option>
                            </select>
                        </div>

                        {newExpense.splitType === 'unequal' && (
                            <div className="form-group custom-splits">
                                <label>Kişiye Özel Tutarlar</label>
                                {(group.members || []).map(member => {
                                    const split = newExpense.splits.find(s => s.memberId === member.id) || { amount: '' };
                                    return (
                                        <div key={member.id} className="custom-split-item">
                                            <span>{member.name}</span>
                                            <input
                                                type="number"
                                                value={split.amount}
                                                onChange={(e) => handleCustomSplitChange(member.id, e.target.value)}
                                                placeholder="0,00"
                                                step="0.01"
                                            />
                                        </div>
                                    )
                                })}
                                <div className={`split-summary ${Math.abs(remainingToSplit) < 0.01 ? 'balanced' : 'unbalanced'}`}>
                                    {Math.abs(remainingToSplit) < 0.01 ? 'Toplamlar Eşit' : `Kalan: ${formatCurrency(remainingToSplit)}`}
                                </div>
                            </div>
                        )}

                        {error && <p style={{ color: 'var(--danger-color)' }}>{error}</p>}
                        <button type="submit" className="form-button" disabled={isFormInvalid}>Harcama Ekle</button>
                    </form>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                    <div className="detail-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                            <h3>Kim Kime Borçlu?</h3>
                            {settlementSuggestions.length > 0 &&
                                <button className="cta-button" style={{ padding: '8px 16px', fontSize: '0.9rem' }} onClick={() => onNavigate('settlement', group.id)}>
                                    Hesaplaş
                                </button>
                            }
                        </div>
                         <ul className="balance-list">
                            {balances.map(b => (
                                // FIX: Use a unique and stable key for list items. `b.id` is suitable.
                                <li key={b.id} className={b.balance >= 0 ? 'positive' : 'negative'}>
                                    <span>{b.name}</span>
                                    <span>{formatCurrency(b.balance)}</span>
                                </li>
                            ))}
                        </ul>
                        {settlementSuggestions.length > 0 &&
                            <div className="suggestion-box">
                                <p><strong>Öneri:</strong> {settlementSuggestions[0]}</p>
                            </div>
                        }
                    </div>
                     <div className="detail-card">
                        <h3>Son Harcamalar</h3>
                         <ul className="expense-list">
                            {(group.expenses || []).slice(-5).reverse().map(expense => (
                                <li key={expense.id}>
                                    <div>
                                        <p className="expense-description">{expense.description}</p>
                                        <p className="expense-meta">
                                            <span>Ödeyen: {(group.members.find(m => m.id === expense.paidBy))?.name || 'Bilinmiyor'}</span>
                                            <span>{formatDate(expense.date)}</span>
                                        </p>
                                    </div>
                                    <p className="expense-amount">{formatCurrency(expense.amount)}</p>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>
            </div>
        </div>
    );
}

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);