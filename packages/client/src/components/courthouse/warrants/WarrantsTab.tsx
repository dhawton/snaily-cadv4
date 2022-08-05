import * as React from "react";
import { Button } from "components/Button";
import { TabsContent } from "components/shared/TabList";
import { useModal } from "state/modalState";
import { useTranslations } from "next-intl";
import { ModalIds } from "types/ModalIds";
import { Table } from "components/shared/Table";
import type { Warrant } from "@snailycad/types";
import { FullDate } from "components/shared/FullDate";
import { AlertModal } from "components/modal/AlertModal";
import useFetch from "lib/useFetch";
import { usePermission, Permissions } from "hooks/usePermission";
import type { GetActiveWarrantsData } from "@snailycad/types/api";
import { useTemporaryItem } from "hooks/shared/useTemporaryItem";
import { CreateWarrantModal } from "components/leo/modals/CreateWarrantModal";

interface Props {
  warrants: GetActiveWarrantsData;
}

export function WarrantsTab(props: Props) {
  const [warrants, setWarrants] = React.useState(props.warrants);
  const [tempWarrant, warrantState] = useTemporaryItem(warrants);

  const t = useTranslations("Courthouse");
  const common = useTranslations("Common");
  const { openModal, closeModal } = useModal();
  const { state, execute } = useFetch();
  const { hasPermissions } = usePermission();
  const hasManagePermissions = hasPermissions([Permissions.ManageCourthouseWarrants], true);

  async function deleteWarrant() {
    if (!tempWarrant) return;

    const { json } = await execute({
      path: `/warrants/${tempWarrant.id}`,
      method: "DELETE",
    });

    if (typeof json === "boolean") {
      setWarrants((p) => p.filter((v) => v.id !== tempWarrant.id));
      warrantState.setTempId(null);
      closeModal(ModalIds.AlertDeleteCourthousePost);
    }
  }

  function handleManageClick(post: Warrant) {
    warrantState.setTempId(post.id);
    openModal(ModalIds.ManageCourthousePost);
  }

  function handleDeleteClick(post: Warrant) {
    warrantState.setTempId(post.id);
    openModal(ModalIds.AlertDeleteCourthousePost);
  }

  return (
    <TabsContent value="warrantsTab">
      <header className="flex justify-between items-center">
        <h3 className="text-2xl font-semibold">{t("warrants")}</h3>

        {hasManagePermissions ? (
          <Button onClick={() => openModal(ModalIds.ManageCourthousePost)}>
            {t("addCourthousePost")}
          </Button>
        ) : null}
      </header>

      {warrants.length <= 0 ? (
        <p className="mt-5">{t("noWarrants")}</p>
      ) : (
        <Table
          data={warrants.map((warrant) => ({
            citizen: `${warrant.citizen.name} ${warrant.citizen.surname}`,
            createdAt: <FullDate>{warrant.createdAt}</FullDate>,
            actions: hasManagePermissions ? (
              <>
                <Button
                  className="ml-2"
                  onClick={() => handleManageClick(warrant)}
                  size="xs"
                  variant="success"
                >
                  {common("manage")}
                </Button>
                <Button
                  onClick={() => handleDeleteClick(warrant)}
                  className="ml-2"
                  size="xs"
                  variant="danger"
                >
                  {common("delete")}
                </Button>
              </>
            ) : null,
          }))}
          columns={[
            { Header: t("citizen"), accessor: "citizen" },
            { Header: common("createdAt"), accessor: "createdAt" },
            { Header: common("actions"), accessor: "actions" },
          ]}
        />
      )}

      {hasManagePermissions ? (
        <>
          <AlertModal
            id={ModalIds.AlertDeleteCourthousePost}
            title={t("deleteCourthousePost")}
            description={t("alert_deleteCourthousePost")}
            onDeleteClick={deleteWarrant}
            onClose={() => warrantState.setTempId(null)}
            state={state}
          />

          <CreateWarrantModal warrant={tempWarrant} onClose={() => warrantState.setTempId(null)} />
        </>
      ) : null}
    </TabsContent>
  );
}
